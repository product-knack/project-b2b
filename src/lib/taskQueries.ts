import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { C } from '../theme';

/* ============ CRM Tasks — mirrors the web useCRMTasks:
   crm_tasks where crm_id = me OR assigned_crm_by_admin = me;
   status pending → in_progress → done; subtasks toggled in the JSON array. ============ */

export type TaskStatus = 'pending' | 'in_progress' | 'done';
export type Subtask = { id: string; text: string; completed: boolean };

export const TASK_PRIORITY_META: Record<string, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: C.red },
  high: { label: 'High', color: C.orange },
  medium: { label: 'Medium', color: C.gold },
  low: { label: 'Low', color: C.blue },
};
export const TASK_CATEGORY_META: Record<string, string> = {
  client_follow_up: 'Client Follow-up',
  session_schedules: 'Session Schedules',
  client_roster: 'Client Roster',
  others: 'Others',
};

export type CrmTask = {
  id: string; title: string; description: string | null;
  priority: string; status: TaskStatus; category: string | null;
  dueDate: string | null; overdue: boolean;
  taggedNames: string[]; subtasks: Subtask[];
  byAdmin: boolean; createdAt: string; completedAt: string | null;
};

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim();

export function useCrmTasks(crmId: string | null) {
  return useQuery({
    // 'crm-my-tasks' — NOT 'crm-tasks': that key belongs to the workspace tile
    // hook (crmTabQueries) whose rows have no subtasks/tagged fields.
    queryKey: ['crm-my-tasks', crmId],
    enabled: !!crmId,
    staleTime: 30_000,
    queryFn: async (): Promise<CrmTask[]> => {
      const { data, error } = await supabase
        .from('crm_tasks')
        .select('*')
        .or(`crm_id.eq.${crmId},assigned_crm_by_admin.eq.${crmId}`)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];

      // Tagged entries may be UUID strings or {id, name} objects (admin-created).
      const entryOf = (raw: any): { id: string; name?: string } | null => {
        if (!raw) return null;
        if (typeof raw === 'string') return { id: raw };
        if (typeof raw === 'object' && typeof raw.id === 'string') return { id: raw.id, name: raw.name };
        return null;
      };
      const allTagged = rows.flatMap((r) => [...(r.tagged_clients ?? []), ...(r.tagged_trainers ?? [])])
        .map(entryOf).filter(Boolean) as { id: string; name?: string }[];
      const ids = [...new Set(allTagged.filter((e) => !e.name).map((e) => e.id))];
      const names = new Map<string, string>();
      if (ids.length) {
        const [profR, clR] = await Promise.all([
          supabase.from('profiles').select('id, first_name, last_name').in('id', ids),
          supabase.from('clients').select('id, first_name, last_name').in('id', ids),
        ]);
        (profR.data ?? []).forEach((p: any) => names.set(p.id, fullName(p)));
        (clR.data ?? []).forEach((p: any) => { if (!names.has(p.id)) names.set(p.id, fullName(p)); });
      }

      const today = new Date(); today.setHours(0, 0, 0, 0);
      return rows.map((r) => {
        const tagged = [...(r.tagged_clients ?? []), ...(r.tagged_trainers ?? [])]
          .map(entryOf).filter(Boolean)
          .map((e: any) => e.name || names.get(e.id) || null)
          .filter(Boolean) as string[];
        const status: TaskStatus = r.status === 'done' || r.is_completed ? 'done' : r.status === 'in_progress' ? 'in_progress' : 'pending';
        return {
          id: r.id, title: r.title ?? 'Task', description: r.description ?? null,
          priority: r.priority ?? 'medium', status,
          category: r.category ?? null, dueDate: r.due_date ?? null,
          overdue: status !== 'done' && !!r.due_date && new Date(r.due_date).getTime() < today.getTime(),
          taggedNames: [...new Set(tagged)],
          subtasks: Array.isArray(r.subtasks) ? r.subtasks : [],
          byAdmin: r.by_admin === true,
          createdAt: r.created_at, completedAt: r.completed_at ?? null,
        };
      });
    },
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { crmId: string; title: string; description: string; priority: string; category: string; dueDate: string | null; taggedId?: string | null }) => {
      if (!input.title.trim()) throw new Error('Title is required');
      const { error } = await supabase.from('crm_tasks').insert({
        crm_id: input.crmId,
        title: input.title.trim(),
        description: input.description.trim() || null,
        priority: input.priority,
        status: 'pending',
        category: input.category,
        due_date: input.dueDate,
        tagged_clients: input.taggedId ? [input.taggedId] : [],
        tagged_trainers: [],
        subtasks: [],
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm-my-tasks'] }); qc.invalidateQueries({ queryKey: ['crm-tasks'] }); },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Record<string, any> }) => {
      const { error } = await supabase.from('crm_tasks').update(input.patch).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    // Optimistic: flip the task in the cache immediately so the status change is
    // instant (the card moves to its new tab without waiting on the network).
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['crm-my-tasks'] });
      const prev = qc.getQueriesData({ queryKey: ['crm-my-tasks'] });
      qc.setQueriesData({ queryKey: ['crm-my-tasks'] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((t: any) => {
          if (t.id !== input.id) return t;
          const p = input.patch;
          const next = { ...t };
          if (p.status !== undefined || p.is_completed !== undefined) {
            next.status = p.status === 'done' || p.is_completed ? 'done' : p.status === 'in_progress' ? 'in_progress' : 'pending';
          }
          if (p.subtasks !== undefined) next.subtasks = p.subtasks;
          if (p.completed_at !== undefined) next.completedAt = p.completed_at;
          return next;
        });
      });
      return { prev };
    },
    onError: (_e, _v, ctx: any) => {
      (ctx?.prev ?? []).forEach(([key, data]: any) => qc.setQueryData(key, data));
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['crm-my-tasks'] }); qc.invalidateQueries({ queryKey: ['crm-tasks'] }); },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('crm_tasks').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm-my-tasks'] }); qc.invalidateQueries({ queryKey: ['crm-tasks'] }); },
  });
}
