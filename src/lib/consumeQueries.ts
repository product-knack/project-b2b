import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ CRM Session Consumption — mirrors the web SessionConsumption page:
   useCRMInactiveClients (no completed session in N days + cycle math) and
   useSessionsBreakdown (sessions per client grouped by professional role). ============ */

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';

export const INACTIVE_PERIODS = [3, 6, 7, 14, 30, 45] as const;

export type InactiveClient = {
  id: string; name: string; subscription: string | null;
  completed: number; totalSessions: number; remainingInCycle: number;
  sessionsPerCycle: number; cycleType: string | null;
  lastWorkout: string | null; lastTrainer: string | null; daysInactive: number | null;
};

export function useInactiveClients(crmId: string | null, days: number) {
  return useQuery({
    queryKey: ['crm-inactive-clients', crmId, days],
    enabled: !!crmId,
    staleTime: 60_000,
    queryFn: async (): Promise<InactiveClient[]> => {
      const { data: assigned, error: aErr } = await supabase
        .from('trainer_clients')
        .select('client_id, clients(id, first_name, last_name, status, subscription_type, sessions_per_cycle, cycle_type, session_package, created_at)')
        .eq('trainer_id', crmId).eq('actively_training', true);
      if (aErr) throw new Error(aErr.message);
      // Only active, subscribed clients — hide anyone with no subscription type set.
      const hasSub = (c: any) => c?.subscription_type != null && String(c.subscription_type).trim() !== '';
      const rows = ((assigned ?? []) as any[]).map((r) => r.clients).filter((c) => c && c.status === 'active' && hasSub(c));
      if (!rows.length) return [];
      const ids = rows.map((c) => c.id);

      const cutoff = new Date(Date.now() - days * 864e5).toISOString();
      const [recentR, renR, allDoneR] = await Promise.all([
        supabase.from('training_sessions').select('client_id').in('client_id', ids).eq('status', 'completed').gte('scheduled_at', cutoff),
        supabase.from('client_renewals').select('client_id, renewed_at').in('client_id', ids).order('renewed_at', { ascending: false }),
        supabase.from('training_sessions').select('client_id, scheduled_at').in('client_id', ids).eq('status', 'completed'),
      ]);
      const activeRecently = new Set((recentR.data ?? []).map((r: any) => r.client_id));
      const latestRenewal = new Map<string, string>();
      (renR.data ?? []).forEach((r: any) => { if (!latestRenewal.has(r.client_id)) latestRenewal.set(r.client_id, r.renewed_at); });
      const doneByClient = new Map<string, string[]>();
      (allDoneR.data ?? []).forEach((s: any) => doneByClient.set(s.client_id, [...(doneByClient.get(s.client_id) ?? []), s.scheduled_at]));

      const inactive = rows.filter((c) => !activeRecently.has(c.id));
      // Last session ever (before the window too) for display — like the web.
      const lastSession = new Map<string, { at: string; trainerId: string | null }>();
      if (inactive.length) {
        const { data: allSess } = await supabase
          .from('training_sessions')
          .select('client_id, scheduled_at, trainer_id')
          .in('client_id', inactive.map((c) => c.id))
          .order('scheduled_at', { ascending: false });
        (allSess ?? []).forEach((s: any) => {
          if (!lastSession.has(s.client_id)) lastSession.set(s.client_id, { at: s.scheduled_at, trainerId: s.trainer_id ?? null });
        });
      }
      const trainerIds = [...new Set([...lastSession.values()].map((v) => v.trainerId).filter(Boolean))] as string[];
      const trainerNames = new Map<string, string>();
      if (trainerIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name').in('id', trainerIds);
        (profs ?? []).forEach((p: any) => trainerNames.set(p.id, fullName(p)));
      }

      return inactive
        .map((c) => {
          const start = latestRenewal.get(c.id) || c.created_at;
          const completed = (doneByClient.get(c.id) ?? []).filter((at) => at >= start).length;
          const totalSessions = parseInt(c.session_package || '0') || 0;
          const perCycle = Number(c.sessions_per_cycle) || 0;
          const inCycle = perCycle > 0 ? completed % perCycle : completed;
          const last = lastSession.get(c.id);
          return {
            id: c.id, name: fullName(c), subscription: c.subscription_type ?? null,
            completed, totalSessions,
            remainingInCycle: perCycle > 0 ? perCycle - inCycle : 0,
            sessionsPerCycle: perCycle, cycleType: c.cycle_type ?? null,
            lastWorkout: last?.at ?? null,
            lastTrainer: last?.trainerId ? trainerNames.get(last.trainerId) ?? null : null,
            daysInactive: last?.at ? Math.max(0, Math.floor((Date.now() - new Date(last.at).getTime()) / 864e5)) : null,
          };
        })
        // Longest-inactive first (never-trained clients at the very top).
        .sort((a, b) => (b.daysInactive ?? 9999) - (a.daysInactive ?? 9999));
    },
  });
}

/* ---------- Sessions breakdown by professional role ---------- */
export const BREAKDOWN_PERIODS = [7, 14, 30, 90] as const;
export type RoleBreakdown = { role: string; totalSessions: number; professionals: { id: string; name: string; sessionCount: number }[] };
export type ClientBreakdown = { clientId: string; clientName: string; totalSessions: number; roles: RoleBreakdown[] };

const ROLE_LABELS: Record<string, string> = {
  trainer: 'Trainers', doctor: 'Doctors', others: 'Doctors', coach: 'Coaches',
  physiotherapist: 'Physiotherapists', admin: 'Administrators', crm: 'CRM',
};

export function useSessionsBreakdown(crmId: string | null, days: number) {
  return useQuery({
    queryKey: ['crm-sessions-breakdown', crmId, days],
    enabled: !!crmId,
    staleTime: 60_000,
    queryFn: async (): Promise<ClientBreakdown[]> => {
      const { data: assigned, error: aErr } = await supabase
        .from('trainer_clients').select('client_id').eq('trainer_id', crmId).eq('actively_training', true);
      if (aErr) throw new Error(aErr.message);
      const ids = [...new Set((assigned ?? []).map((r: any) => r.client_id))];
      if (!ids.length) return [];
      const { data: clients } = await supabase
        .from('clients').select('id, first_name, last_name').in('id', ids).eq('status', 'active');

      const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
      const { data: sessions, error: sErr } = await supabase
        .from('training_sessions')
        .select('id, client_id, trainer_id, status, scheduled_at')
        .in('client_id', ids)
        .in('status', ['completed', 'cancelled'])
        .gte('scheduled_at', start);
      if (sErr) throw new Error(sErr.message);
      const sess = (sessions ?? []) as any[];

      // Professionals (two-step — no FK embed dependency).
      const profIds = [...new Set(sess.map((s) => s.trainer_id).filter(Boolean))];
      const profs = new Map<string, { name: string; role: string }>();
      if (profIds.length) {
        const { data: p } = await supabase.from('profiles').select('id, first_name, last_name, role').in('id', profIds);
        (p ?? []).forEach((x: any) => profs.set(x.id, { name: fullName(x), role: x.role ?? 'trainer' }));
      }

      return ((clients ?? []) as any[])
        .map((client) => {
          const mine = sess.filter((s) => s.client_id === client.id && s.trainer_id && profs.has(s.trainer_id));
          const byProf = new Map<string, number>();
          mine.forEach((s) => byProf.set(s.trainer_id, (byProf.get(s.trainer_id) ?? 0) + 1));
          const roleMap = new Map<string, RoleBreakdown>();
          byProf.forEach((count, pid) => {
            const prof = profs.get(pid)!;
            const role = ROLE_LABELS[prof.role] ?? 'Others';
            if (!roleMap.has(role)) roleMap.set(role, { role, totalSessions: 0, professionals: [] });
            const rb = roleMap.get(role)!;
            rb.totalSessions += count;
            rb.professionals.push({ id: pid, name: prof.name, sessionCount: count });
          });
          roleMap.forEach((rb) => rb.professionals.sort((a, b) => b.sessionCount - a.sessionCount));
          return {
            clientId: client.id, clientName: fullName(client),
            totalSessions: mine.length,
            roles: [...roleMap.values()].sort((a, b) => b.totalSessions - a.totalSessions),
          };
        })
        .sort((a, b) => b.totalSessions - a.totalSessions);
    },
  });
}
