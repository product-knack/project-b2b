import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { istDaysAgo } from './academyQueries';

/* ============================================================================
   Academy analysers — Daily Goals compliance and Weekly Summary read rates.
   Pure client-side aggregation over table selects (no RPCs, no edge functions),
   paginated past Supabase's 1000-row cap. RLS scopes what each account sees.
   ========================================================================== */

async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
}
const personName = (p: any, fallback: string) =>
  `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || fallback;

/* ---------------------------------------------------------------------------
   Daily Goals Analyser — trainer log compliance over the last 7 COMPLETED days
   (yesterday backwards; today is still in progress so it never counts against
   anyone). Three metrics per client per day: Sleep, Steps, Nutrition.
     total = clients x 7 x 3 ; compliance% = logged / total x 100
   Bands: <40 Critical, 40-75 Warning, >=75 Good. Sorted WORST first.
   ------------------------------------------------------------------------- */
export const DG_BANDS = { critical: 40, warning: 75 };
export const dgBand = (pct: number): 'critical' | 'warning' | 'good' =>
  pct < DG_BANDS.critical ? 'critical' : pct < DG_BANDS.warning ? 'warning' : 'good';

export type DgClient = { clientId: string; name: string; sleep: number; steps: number; nutrition: number };
export type DgTrainer = {
  trainerId: string; name: string; clients: number;
  total: number; logged: number; pct: number;
  sleepPct: number; stepsPct: number; nutritionPct: number;
  perClient: DgClient[];
};
export type DailyGoalsData = {
  days: number; from: string; to: string;
  overallPct: number; totalLogged: number; totalPoints: number;
  trainers: DgTrainer[];
};

export function useDailyGoalsAnalyser() {
  return useQuery({
    queryKey: ['academy-daily-goals'],
    staleTime: 300_000,
    queryFn: async (): Promise<DailyGoalsData> => {
      const DAYS = 7;
      const from = istDaysAgo(DAYS), to = istDaysAgo(1);
      const [links, clients, sleep, nutrition] = await Promise.all([
        fetchAll<any>((f, t) => supabase.from('trainer_clients').select('trainer_id, client_id').eq('actively_training', true).range(f, t)),
        fetchAll<any>((f, t) => supabase.from('clients').select('id, first_name, last_name, subscription_type').eq('status', 'active').range(f, t)),
        fetchAll<any>((f, t) => supabase.from('daily_sleep_logs').select('client_id, log_date').gte('log_date', from).lte('log_date', to).range(f, t)),
        fetchAll<any>((f, t) => supabase.from('nutrition_tracker').select('client_id, rating_date, nutrition_rating, steps_by_trainer').gte('rating_date', from).lte('rating_date', to).range(f, t)),
      ]);
      // Eligible = active AND not on Trial (web rule).
      const eligible = new Map<string, string>();
      clients.forEach((c: any) => {
        if (String(c.subscription_type ?? '').toLowerCase() === 'trial') return;
        eligible.set(c.id, personName(c, 'Client'));
      });
      // Keys are client|date so each (client, day, metric) can only count once.
      const sleepSet = new Set(sleep.map((r: any) => `${r.client_id}|${r.log_date}`));
      const stepsSet = new Set<string>();
      const nutrSet = new Set<string>();
      nutrition.forEach((r: any) => {
        const k = `${r.client_id}|${r.rating_date}`;
        if (r.steps_by_trainer != null) stepsSet.add(k);
        if (r.nutrition_rating != null) nutrSet.add(k);
      });
      const dayKeys = Array.from({ length: DAYS }, (_, i) => istDaysAgo(i + 1));

      const byTrainer = new Map<string, Set<string>>();
      links.forEach((l: any) => {
        if (!l.trainer_id || !eligible.has(l.client_id)) return;
        if (!byTrainer.has(l.trainer_id)) byTrainer.set(l.trainer_id, new Set());
        byTrainer.get(l.trainer_id)!.add(l.client_id);
      });
      const trainerIds = [...byTrainer.keys()];
      const profs = trainerIds.length
        ? await fetchAll<any>((f, t) => supabase.from('profiles').select('id, first_name, last_name').in('id', trainerIds).range(f, t))
        : [];
      const nameById = new Map<string, string>(profs.map((p: any) => [p.id, personName(p, 'Trainer')]));

      const trainers: DgTrainer[] = trainerIds
        .map((tid) => {
          const cids = [...byTrainer.get(tid)!];
          let sleepN = 0, stepsN = 0, nutrN = 0;
          const perClient: DgClient[] = cids
            .map((cid) => {
              let s = 0, st = 0, n = 0;
              dayKeys.forEach((d) => {
                const k = `${cid}|${d}`;
                if (sleepSet.has(k)) s++;
                if (stepsSet.has(k)) st++;
                if (nutrSet.has(k)) n++;
              });
              sleepN += s; stepsN += st; nutrN += n;
              return { clientId: cid, name: eligible.get(cid) ?? 'Client', sleep: s, steps: st, nutrition: n };
            })
            .sort((a, b) => (a.sleep + a.steps + a.nutrition) - (b.sleep + b.steps + b.nutrition));
          const perMetric = cids.length * DAYS;
          const total = perMetric * 3;
          const logged = sleepN + stepsN + nutrN;
          const pctOf = (n: number) => (perMetric ? Math.round((n / perMetric) * 100) : 0);
          return {
            trainerId: tid, name: nameById.get(tid) ?? 'Trainer', clients: cids.length,
            total, logged, pct: total ? Math.round((logged / total) * 100) : 0,
            sleepPct: pctOf(sleepN), stepsPct: pctOf(stepsN), nutritionPct: pctOf(nutrN),
            perClient,
          };
        })
        .filter((t) => t.clients > 0)
        .sort((a, b) => a.pct - b.pct); // worst first

      const totalPoints = trainers.reduce((n, t) => n + t.total, 0);
      const totalLogged = trainers.reduce((n, t) => n + t.logged, 0);
      return {
        days: DAYS, from, to, totalPoints, totalLogged,
        overallPct: totalPoints ? Math.round((totalLogged / totalPoints) * 100) : 0,
        trainers,
      };
    },
  });
}

/* ---------------------------------------------------------------------------
   Weekly Summary Analyser — who actually READS the AI weekly summary.
     client read  = client_acknowledged_at is set
     trainer read = trainer id present in trainer_acknowledgements[]
   Scoped to the last 12 weeks so the mobile fetch stays light (the full table
   holds 12k+ summary rows). Sorted BEST first.
   Bands: >=80 Excellent, >=50 On track, else Needs focus.
   ------------------------------------------------------------------------- */
export const WK_BANDS = { onTrack: 50, excellent: 80 };
export const wkBand = (pct: number): 'excellent' | 'ontrack' | 'focus' =>
  pct >= WK_BANDS.excellent ? 'excellent' : pct >= WK_BANDS.onTrack ? 'ontrack' : 'focus';

export type WkTrainer = { trainerId: string; name: string; total: number; read: number; pct: number };
export type WkClientRow = { clientId: string; name: string; weekStart: string; clientRead: boolean; trainerRead: boolean; acknowledgedAt: string | null };
export type WeeklySummaryData = {
  weeks: string[];
  clientReadPct: number; trainerReadPct: number;
  totalRows: number; clientReadCount: number;
  trainers: WkTrainer[]; clientRows: WkClientRow[];
};

export function useWeeklySummary(week: string | 'latest') {
  return useQuery({
    queryKey: ['academy-weekly-summary', week],
    staleTime: 300_000,
    queryFn: async (): Promise<WeeklySummaryData> => {
      const since = new Date(Date.now() - 84 * 864e5).toISOString().slice(0, 10); // 12 weeks
      const rows = await fetchAll<any>((f, t) =>
        supabase
          .from('weekly_progression_tracking')
          .select('id, client_id, week_start, client_acknowledged_at, trainer_acknowledgements')
          .not('ai_weekly_summary', 'is', null)
          .gte('week_start', since)
          .order('week_start', { ascending: false })
          .range(f, t)
      );
      const weeks = [...new Set(rows.map((r: any) => r.week_start as string))].sort().reverse();

      // "Latest" collapses to each client's most recent summary week.
      let scoped: any[];
      if (week === 'latest') {
        const seen = new Set<string>();
        scoped = rows.filter((r: any) => { if (seen.has(r.client_id)) return false; seen.add(r.client_id); return true; });
      } else {
        scoped = rows.filter((r: any) => r.week_start === week);
      }
      const clientIds = [...new Set(scoped.map((r: any) => r.client_id))].filter(Boolean) as string[];
      if (!clientIds.length) {
        return { weeks, clientReadPct: 0, trainerReadPct: 0, totalRows: 0, clientReadCount: 0, trainers: [], clientRows: [] };
      }

      const clientChunks: any[] = [];
      for (let i = 0; i < clientIds.length; i += 200) {
        const { data } = await supabase.from('clients').select('id, first_name, last_name, coach_id').in('id', clientIds.slice(i, i + 200));
        clientChunks.push(...(data ?? []));
      }
      const links = await fetchAll<any>((f, t) => supabase.from('trainer_clients').select('trainer_id, client_id').eq('actively_training', true).range(f, t));
      const nameById = new Map<string, string>(clientChunks.map((c: any) => [c.id, personName(c, 'Client')]));
      const coachById = new Map<string, string | null>(clientChunks.map((c: any) => [c.id, c.coach_id ?? null]));
      const trainersOf = new Map<string, string[]>();
      links.forEach((l: any) => {
        if (!l.trainer_id || !l.client_id) return;
        if (!trainersOf.has(l.client_id)) trainersOf.set(l.client_id, []);
        trainersOf.get(l.client_id)!.push(l.trainer_id);
      });
      // Assigned trainers, falling back to the client's coach_id (web parity).
      const assignedOf = (cid: string): string[] => {
        const t = trainersOf.get(cid);
        if (t && t.length) return t;
        const c = coachById.get(cid);
        return c ? [c] : [];
      };
      const acksOf = (r: any): string[] => (Array.isArray(r.trainer_acknowledgements) ? r.trainer_acknowledgements.map(String) : []);

      const clientRows: WkClientRow[] = scoped
        .map((r: any) => {
          const ack = acksOf(r);
          return {
            clientId: r.client_id, name: nameById.get(r.client_id) ?? 'Client', weekStart: r.week_start,
            clientRead: !!r.client_acknowledged_at,
            trainerRead: assignedOf(r.client_id).some((t) => ack.includes(t)),
            acknowledgedAt: r.client_acknowledged_at ?? null,
          };
        })
        .sort((a, b) => Number(a.clientRead) - Number(b.clientRead) || a.name.localeCompare(b.name));

      // Each summary row counts once for every trainer assigned to that client.
      const tally = new Map<string, { total: number; read: number }>();
      scoped.forEach((r: any) => {
        const ack = acksOf(r);
        assignedOf(r.client_id).forEach((tid) => {
          if (!tally.has(tid)) tally.set(tid, { total: 0, read: 0 });
          const e = tally.get(tid)!;
          e.total++;
          if (ack.includes(tid)) e.read++;
        });
      });
      const tIds = [...tally.keys()];
      const profs = tIds.length
        ? await fetchAll<any>((f, t) => supabase.from('profiles').select('id, first_name, last_name').in('id', tIds).range(f, t))
        : [];
      const tName = new Map<string, string>(profs.map((p: any) => [p.id, personName(p, 'Trainer')]));
      const trainers: WkTrainer[] = tIds
        .map((tid) => {
          const e = tally.get(tid)!;
          return { trainerId: tid, name: tName.get(tid) ?? 'Trainer', total: e.total, read: e.read, pct: e.total ? Math.round((e.read / e.total) * 100) : 0 };
        })
        .sort((a, b) => b.pct - a.pct || b.total - a.total || a.name.localeCompare(b.name)); // best first

      const clientReadCount = clientRows.filter((r) => r.clientRead).length;
      const trainerTotal = trainers.reduce((n, t) => n + t.total, 0);
      const trainerRead = trainers.reduce((n, t) => n + t.read, 0);
      return {
        weeks,
        totalRows: clientRows.length,
        clientReadCount,
        clientReadPct: clientRows.length ? Math.round((clientReadCount / clientRows.length) * 100) : 0,
        trainerReadPct: trainerTotal ? Math.round((trainerRead / trainerTotal) * 100) : 0,
        trainers, clientRows,
      };
    },
  });
}
