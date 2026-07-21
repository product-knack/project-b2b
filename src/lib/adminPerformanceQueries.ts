import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Admin — Performance (web AdminCRMPerformance + TrainerPerformanceTable ports) ============ */

const nameOf = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Unknown';

export type LeaderboardEntry = {
  userId: string; userName: string; rank: number; totalScore: number;
  referrals: number; crossSells: number; packageUpgrades: number; subscriptionUpgrades: number;
};
/* Web useIncentiveLeaderboard: approved referrals + incentive_events counted per CRM;
   every CRM profile starts at 0; points = plain sum of the four counts. */
export function useCrmLeaderboard(period: 'month' | 'all') {
  return useQuery({
    queryKey: ['incentive-leaderboard', period],
    staleTime: 60_000,
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      let refQ = supabase.from('referrals').select('referrer_id, status, created_at').eq('status', 'approved');
      if (period === 'month') refQ = refQ.gte('created_at', monthStart.toISOString());
      let evQ = supabase.from('incentive_events').select('user_id, event_type, event_date');
      if (period === 'month') evQ = evQ.gte('event_date', monthStart.toISOString());
      const [{ data: referrals, error: e1 }, { data: events, error: e2 }, { data: profiles, error: e3 }] = await Promise.all([
        refQ, evQ, supabase.from('profiles').select('id, first_name, last_name, role').eq('role', 'crm'),
      ]);
      const err = e1 ?? e2 ?? e3;
      if (err) throw new Error(err.message);
      const scores: Record<string, { referrals: number; crossSells: number; packageUpgrades: number; subscriptionUpgrades: number }> = {};
      (profiles ?? []).forEach((p: any) => { scores[p.id] = { referrals: 0, crossSells: 0, packageUpgrades: 0, subscriptionUpgrades: 0 }; });
      (referrals ?? []).forEach((r: any) => { if (scores[r.referrer_id]) scores[r.referrer_id].referrals++; });
      (events ?? []).forEach((e: any) => {
        const s = scores[e.user_id];
        if (!s) return;
        if (e.event_type === 'cross_sell') s.crossSells++;
        else if (e.event_type === 'package_upgrade') s.packageUpgrades++;
        else if (e.event_type === 'subscription_upgrade') s.subscriptionUpgrades++;
      });
      return Object.entries(scores)
        .map(([userId, s]) => ({
          userId, userName: nameOf((profiles ?? []).find((p: any) => p.id === userId)),
          totalScore: s.referrals + s.crossSells + s.packageUpgrades + s.subscriptionUpgrades, ...s, rank: 0,
        }))
        .sort((a, b) => b.totalScore - a.totalScore)
        .map((e, i) => ({ ...e, rank: i + 1 }));
    },
  });
}

export type TrainerPerf = { id: string; name: string; currentWeek: number; previousWeek: number; diffPct: number };
/* Web TrainerPerformanceTable (admin all-trainers view): completed + attendance_marked
   sessions, rolling 7-day windows (now−7d vs now−14d..now−7d), rounded % diff. */
export function useTrainerPerformance() {
  return useQuery({
    queryKey: ['trainer-performance', 'all'],
    staleTime: 120_000,
    queryFn: async (): Promise<TrainerPerf[]> => {
      const { data: trainers, error } = await supabase.from('profiles').select('id, first_name, last_name').eq('role', 'trainer');
      if (error) throw new Error(error.message);
      const ids = (trainers ?? []).map((t: any) => t.id);
      if (!ids.length) return [];
      const now = new Date();
      const curStart = new Date(now); curStart.setDate(now.getDate() - 7);
      const prevStart = new Date(now); prevStart.setDate(now.getDate() - 14);
      const base = () => supabase.from('training_sessions').select('trainer_id').in('trainer_id', ids).eq('status', 'completed').eq('attendance_marked', true);
      const [{ data: cur, error: cErr }, { data: prev, error: pErr }] = await Promise.all([
        base().gte('scheduled_at', curStart.toISOString()),
        base().gte('scheduled_at', prevStart.toISOString()).lt('scheduled_at', curStart.toISOString()),
      ]);
      const err2 = cErr ?? pErr;
      if (err2) throw new Error(err2.message);
      const count = (rows: any[] | null) => (rows ?? []).reduce((acc: Record<string, number>, s: any) => { acc[s.trainer_id] = (acc[s.trainer_id] ?? 0) + 1; return acc; }, {});
      const c = count(cur); const p = count(prev);
      return (trainers ?? []).map((t: any) => {
        const cw = c[t.id] ?? 0; const pw = p[t.id] ?? 0;
        let pct = 0;
        if (pw === 0 && cw > 0) pct = 100;
        else if (pw > 0) pct = ((cw - pw) / pw) * 100;
        else if (cw === 0 && pw > 0) pct = -100;
        const rounded = Math.round(pct);
        return { id: t.id, name: nameOf(t), currentWeek: cw, previousWeek: pw, diffPct: Object.is(rounded, -0) ? 0 : rounded };
      }).sort((a, b) => b.currentWeek - a.currentWeek);
    },
  });
}
