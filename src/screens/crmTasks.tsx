import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { Page, Badge, MiniAvatar, AnimChip, HScroll } from './common';
import { useAuth } from '../auth';
import { useCrmClientList } from '../lib/crmClientQueries';
import { useCrmTasks, useCreateTask, useUpdateTask, useDeleteTask, TASK_PRIORITY_META, TASK_CATEGORY_META, CrmTask, TaskStatus } from '../lib/taskQueries';
import { SheetShell } from './reportDetail';

/* ============ CRM: Tasks — mirrors the web CRMTasks: personal + admin-assigned
   to-dos with priorities, categories, due dates and subtask checklists. ============ */

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];
const istD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '—');

const INPUT = {
  paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11,
  borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)',
  color: '#fff', fontFamily: F.body, fontSize: 13.5,
} as const;

export function CrmTasks() {
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const tasksQ = useCrmTasks(crmId);
  const updateM = useUpdateTask();
  const deleteM = useDeleteTask();
  const [tab, setTab] = React.useState<TaskStatus>('pending');
  const [newOpen, setNewOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');

  const all = tasksQ.data ?? [];
  const q = query.trim().toLowerCase();
  const matches = (t: CrmTask) => !q || t.title.toLowerCase().includes(q);
  const count = (s: TaskStatus) => all.filter((t) => t.status === s && matches(t)).length;
  const list = all
    .filter((t) => t.status === tab && matches(t))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));

  const setStatus = (t: CrmTask, status: TaskStatus) => {
    const patch: any = { status, is_completed: status === 'done', completed_at: status === 'done' ? new Date().toISOString() : null };
    updateM.mutate({ id: t.id, patch }, { onError: (e: any) => Alert.alert("Couldn't update", e?.message) });
    // Follow the task to its new column so the change is visible instead of the
    // card silently leaving the current tab.
    if (status !== tab) setTab(status);
  };
  const toggleSubtask = (t: CrmTask, subId: string) => {
    const subtasks = (t.subtasks ?? []).map((s) => (s.id === subId ? { ...s, completed: !s.completed } : s));
    updateM.mutate({ id: t.id, patch: { subtasks } }, { onError: (e: any) => Alert.alert("Couldn't update", e?.message) });
  };
  const remove = (t: CrmTask) => {
    Alert.alert('Delete this task?', t.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteM.mutate(t.id, { onError: (e: any) => Alert.alert("Couldn't delete", e?.message) }) },
    ]);
  };

  return (
    <Page gap={13} pt={6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 24 }}>My Tasks</Serif>
          <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Your to-dos and admin-assigned work</Body>
        </View>
        <Pressable onPress={() => setNewOpen(true)}>
          <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 15, borderRadius: 12 }}>
            <Icon name="plus" size={13} color="#fff" strokeWidth={2.6} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>New Task</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Search by title */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.25)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2.2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search tasks by title…"
          placeholderTextColor={C.muted3}
          returnKeyType="search"
          style={{ flex: 1, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13.5 }}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Icon name="close" size={14} color={C.muted} strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>

      {/* Status tabs */}
      <View style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
        {([['pending', 'To Do'], ['in_progress', 'In Progress'], ['done', 'Done']] as [TaskStatus, string][]).map(([id, label]) => {
          const active = tab === id;
          return (
            <AnimChip key={id} grow active={active} onPress={() => setTab(id)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRadius: 10, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
              {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? '#fff' : C.muted }}>{label}</Text>
              {tasksQ.data ? <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: active ? 'rgba(255,255,255,0.85)' : C.muted3 }}>{count(id)}</Text> : null}
            </AnimChip>
          );
        })}
      </View>

      {tasksQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading tasks…</Body>
        </View>
      ) : list.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 9, paddingVertical: 28 }}>
          <Icon name={q ? 'search' : tab === 'done' ? 'inbox' : 'checks'} size={26} color={q ? C.muted3 : tab === 'done' ? C.muted3 : C.green} strokeWidth={2} />
          <Body style={{ fontSize: 12.5, color: q ? C.muted2 : tab === 'done' ? C.muted2 : C.green, fontFamily: q || tab === 'done' ? F.body : F.bodySemi }}>
            {q ? `No ${tab === 'pending' ? 'to-do' : tab === 'in_progress' ? 'in-progress' : 'completed'} tasks match “${query.trim()}”.` : tab === 'pending' ? 'Nothing to do — enjoy it.' : tab === 'in_progress' ? 'Nothing in progress.' : 'No completed tasks yet.'}
          </Body>
        </View>
      ) : (
        list.map((t) => {
          const pm = TASK_PRIORITY_META[t.priority] ?? TASK_PRIORITY_META.medium;
          const open = expanded === t.id;
          const subs = t.subtasks ?? [];
          const tagged = t.taggedNames ?? [];
          const subDone = subs.filter((s) => s.completed).length;
          return (
            <View key={t.id} style={{ borderRadius: 16, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: t.overdue ? hexA(C.red, 0.3) : hexA(pm.color, 0.18), overflow: 'hidden' }}>
              <View style={{ height: 2.5, backgroundColor: t.overdue ? hexA(C.red, 0.55) : hexA(pm.color, 0.5) }} />
              <Pressable onPress={() => setExpanded(open ? null : t.id)} style={{ padding: 13, gap: 9 }}>
                {/* Title row */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
                  {/* One-tap complete circle */}
                  <Pressable
                    onPress={() => setStatus(t, t.status === 'done' ? 'pending' : 'done')}
                    hitSlop={8}
                    style={{ width: 24, height: 24, borderRadius: 12, marginTop: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.status === 'done' ? hexA(C.green, 0.2) : 'rgba(255,255,255,0.04)', borderWidth: 1.5, borderColor: t.status === 'done' ? C.green : 'rgba(255,255,255,0.25)' }}
                  >
                    {t.status === 'done' ? <Icon name="checks" size={12} color={C.green} strokeWidth={2.8} /> : null}
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: t.status === 'done' ? C.muted2 : '#fff', textDecorationLine: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</Body>
                    {t.description ? <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 3 }} numberOfLines={open ? 12 : 2}>{t.description}</Body> : null}
                  </View>
                </View>
                {/* Meta chips */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Badge text={pm.label} color={pm.color} />
                  {t.category ? <Badge text={TASK_CATEGORY_META[t.category] ?? t.category} color={C.gold} /> : null}
                  {t.dueDate ? <Badge text={`${t.overdue ? 'Overdue · ' : 'Due '}${istD(t.dueDate)}`} color={t.overdue ? C.red : C.blue} /> : null}
                  {t.byAdmin ? <Badge text="From Admin" color={C.purple} /> : null}
                  {subs.length ? <Badge text={`${subDone}/${subs.length} steps`} color={C.green} /> : null}
                </View>
                {/* Always-visible status stepper: To Do → In Progress → Done */}
                <View style={{ flexDirection: 'row', gap: 5 }}>
                  {([['pending', 'To Do', C.gold], ['in_progress', 'In Progress', C.blue], ['done', 'Done', C.green]] as [TaskStatus, string, string][]).map(([st, label, col]) => {
                    const active = t.status === st;
                    return (
                      <Pressable
                        key={st}
                        onPress={() => !active && setStatus(t, st)}
                        style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 9, backgroundColor: active ? hexA(col, 0.16) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: active ? hexA(col, 0.55) : 'rgba(255,255,255,0.08)' }}
                      >
                        <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? col : C.muted }}>{active ? `● ${label}` : label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {tagged.length ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Icon name="user" size={11} color={C.muted3} strokeWidth={2} />
                    <Body style={{ flex: 1, fontSize: 11, color: C.muted2 }} numberOfLines={1}>{tagged.join(' · ')}</Body>
                  </View>
                ) : null}
                {/* Expanded: subtasks + actions */}
                {open ? (
                  <View style={{ gap: 8, marginTop: 2 }}>
                    {subs.length ? (
                      <View style={{ gap: 5 }}>
                        {subs.map((s) => (
                          <Pressable key={s.id} onPress={() => toggleSubtask(t, s.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.22)' }}>
                            <View style={{ width: 17, height: 17, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: s.completed ? hexA(C.green, 0.2) : 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: s.completed ? C.green : 'rgba(255,255,255,0.22)' }}>
                              {s.completed ? <Icon name="checks" size={9} color={C.green} strokeWidth={2.8} /> : null}
                            </View>
                            <Body style={{ flex: 1, fontSize: 11.5, color: s.completed ? C.muted3 : C.ink3, textDecorationLine: s.completed ? 'line-through' : 'none' }}>{s.text}</Body>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: 7 }}>
                      {t.status === 'pending' ? (
                        <Pressable onPress={() => setStatus(t, 'in_progress')} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.4) }}>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.blue }}>Start Task</Text>
                        </Pressable>
                      ) : null}
                      {t.status !== 'done' ? (
                        <Pressable onPress={() => setStatus(t, 'done')} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: hexA(C.green, 0.13), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.green }}>Mark Done</Text>
                        </Pressable>
                      ) : (
                        <Pressable onPress={() => setStatus(t, 'pending')} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.blue }}>Reopen</Text>
                        </Pressable>
                      )}
                      {!t.byAdmin ? (
                        <Pressable onPress={() => remove(t)} style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: hexA(C.red, 0.09), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
                          <Icon name="close" size={13} color={C.red} strokeWidth={2.4} />
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ) : null}
                <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{open ? 'TAP TO COLLAPSE' : 'TAP FOR DETAILS'} · CREATED {istD(t.createdAt).toUpperCase()}</Mono>
              </Pressable>
            </View>
          );
        })
      )}

      <NewTaskSheet visible={newOpen} onClose={() => setNewOpen(false)} crmId={crmId} />
    </Page>
  );
}

/* ---------- New task sheet ---------- */
function NewTaskSheet({ visible, onClose, crmId }: { visible: boolean; onClose: () => void; crmId: string | null }) {
  const createM = useCreateTask();
  const clientsQ = useCrmClientList(visible ? crmId : null, 'active');
  const [title, setTitle] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [priority, setPriority] = React.useState('medium');
  const [category, setCategory] = React.useState('client_follow_up');
  const [dueDays, setDueDays] = React.useState<number | null>(1);
  const [tagOpen, setTagOpen] = React.useState(false);
  const [tagQuery, setTagQuery] = React.useState('');
  const [tagged, setTagged] = React.useState<{ id: string; name: string } | null>(null);

  const q = tagQuery.trim().toLowerCase();
  const clients = (clientsQ.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));

  const submit = async () => {
    if (!crmId || !title.trim()) return;
    const dueDate = dueDays != null ? new Date(Date.now() + dueDays * 864e5).toISOString() : null;
    try {
      await createM.mutateAsync({ crmId, title, description: desc, priority, category, dueDate, taggedId: tagged?.id ?? null });
      setTitle(''); setDesc(''); setPriority('medium'); setCategory('client_follow_up'); setDueDays(1); setTagged(null); setTagOpen(false);
      onClose();
    } catch (e: any) { Alert.alert("Couldn't create task", e?.message ?? 'Try again.'); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.orange} icon="checks" title="New Task" subtitle="WHAT NEEDS DOING?">
      <TextInput value={title} onChangeText={setTitle} placeholder="Task title *" placeholderTextColor={C.muted3} style={[INPUT, { fontSize: 14.5 }]} />
      <TextInput value={desc} onChangeText={setDesc} placeholder="Details (optional)" placeholderTextColor={C.muted3} multiline style={[INPUT, { minHeight: 56, textAlignVertical: 'top' }]} />

      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>PRIORITY</Mono>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {Object.entries(TASK_PRIORITY_META).reverse().map(([id, meta]) => {
          const active = priority === id;
          return (
            <AnimChip key={id} grow active={active} onPress={() => setPriority(id)} style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(meta.color, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(meta.color, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? meta.color : C.muted }}>{meta.label}</Text>
            </AnimChip>
          );
        })}
      </View>

      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>CATEGORY</Mono>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {Object.entries(TASK_CATEGORY_META).map(([id, label]) => {
          const active = category === id;
          return (
            <AnimChip key={id} active={active} onPress={() => setCategory(id)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.gold, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? C.gold : C.muted }}>{label}</Text>
            </AnimChip>
          );
        })}
      </View>

      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>DUE</Mono>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {([[0, 'Today'], [1, 'Tomorrow'], [3, '+3 days'], [7, '+1 week'], [null, 'No date']] as [number | null, string][]).map(([v, lbl]) => {
          const active = dueDays === v;
          return (
            <AnimChip key={lbl} grow active={active} onPress={() => setDueDays(v)} style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(C.blue, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.blue, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10, color: active ? C.blue : C.muted }}>{lbl}</Text>
            </AnimChip>
          );
        })}
      </View>

      {/* Optional client tag */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>TAG A CLIENT (OPTIONAL)</Mono>
        {tagged ? (
          <Pressable onPress={() => setTagged(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.45) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.orange }}>{tagged.name}</Text>
            <Icon name="close" size={10} color={C.orange} strokeWidth={2.6} />
          </Pressable>
        ) : (
          <Pressable onPress={() => setTagOpen(!tagOpen)} style={{ paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.muted }}>{tagOpen ? 'Close' : '+ Tag'}</Text>
          </Pressable>
        )}
      </View>
      {tagOpen && !tagged ? (
        <View style={{ gap: 6 }}>
          <TextInput value={tagQuery} onChangeText={setTagQuery} placeholder="Search clients…" placeholderTextColor={C.muted3} style={INPUT} />
          {clients.slice(0, 6).map((c, i) => (
            <Pressable key={c.id} onPress={() => { setTagged({ id: c.id, name: c.name }); setTagOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)' }}>
              <MiniAvatar initial={initials(c.name)} colors={AVS[i % AVS.length]} size={28} />
              <Body style={{ flex: 1, fontSize: 12.5, color: '#fff' }}>{c.name}</Body>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Pressable onPress={submit} disabled={!title.trim() || createM.isPending} style={{ opacity: title.trim() && !createM.isPending ? 1 : 0.5 }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{createM.isPending ? 'Saving…' : 'Create Task'}</Text>
        </LinearGradient>
      </Pressable>
    </SheetShell>
  );
}
