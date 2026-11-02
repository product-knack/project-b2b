# iOS handoff: Managers Dashboard month tabs follow the competition length (2 Nov 2026)

## 1. What the user sees
- Managers Dashboard (route `mgr-dash`): the period pills were always Overall + three months carved from the
  competition start. The competition running now is 1 Aug 2026 to 31 Jan 2027 (six months), so November, December
  and January had no pill and "this month" could only be seen folded into Overall.
- Now: Overall plus one pill per competition month: **Overall, Aug, Sep, Oct, Nov, Dec, Jan 27** (a month in a later
  year than the start carries the two-digit year). The row scrolls sideways. Older three-month competitions still
  show three pills. A remembered pill the period does not have falls back to Overall.
- Nothing else changes: the counts per pill are the same server RPC (`get_manager_team_counts`) over that month
  clipped to the period; the ranking formula, podium, breakdown and member status are untouched.

## 2. Data / server contract
- No server change. `manager_score.team_start` / `team_end` define the period; the RPC takes any date range.
- Month count = calendar months from `team_start` to `team_end` inclusive; an open period (no end) runs to the
  current month; at least 1, at most 12. Month N's range = the Nth calendar month from the start, clipped to the
  period (the old maths, the offset now comes from the pill number). Fixed month names (Jan ... Dec), not the
  runtime's locale (en-GB gives "Sept" on some engines).
- Query key `['manager-leaderboard', 'v5', monthFilter]` (persisted cache; v4 rows carried a fixed three labels).

## 3. Code to port
### `src/lib/managerMonths.ts` (new, pure; copy byte for byte)
```ts
/* Managers Leaderboard competition months (2 Nov 2026). The month tabs were fixed at three (month1..month3 carved
   from team_start); the competition running since 1 Aug 2026 lasts six months (to 31 Jan 2027), so November and the
   months after it had no tab. The tabs now follow the period: one per month from team_start to team_end (an ongoing
   period with no end: to the current month). Same rule as the web hook useManagerLeaderboard.ts; fix together.
   Pure: no React, no network; tested in node (tests/rules/manager_months_test.js); copied byte for byte to iOS. */

export type MgrMonthFilter = 'overall' | `month${number}`;
export const MAX_COMPETITION_MONTHS = 12;

const fmtDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const firstOf = (iso: string) => { const d = new Date(iso + 'T00:00:00'); return new Date(d.getFullYear(), d.getMonth(), 1); };

/** 'month3' → 2 (0-based competition month); 'overall' or anything else → null. */
export const monthIndexOf = (filter: string | null | undefined): number | null => {
  const m = String(filter ?? '').match(/^month(\d{1,2})$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= MAX_COMPETITION_MONTHS ? n - 1 : null;
};
export const monthFilterOf = (index: number): MgrMonthFilter => `month${index + 1}` as MgrMonthFilter;

/** How many calendar months the competition spans: team_start to team_end inclusive; with no end, to today's month
    (at least 1, at most MAX_COMPETITION_MONTHS). */
export const competitionMonthCount = (periodStart: string, periodEnd: string | null, todayIso: string = fmtDay(new Date())): number => {
  const s = firstOf(periodStart);
  const e = firstOf(periodEnd ?? todayIso);
  const n = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
  return Math.max(1, Math.min(MAX_COMPETITION_MONTHS, n));
};

/** Fixed names: the runtime's en-GB short month is "Sept" on some engines and "Sep" on others. */
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Aug", "Sep", ... ; a month in a later year than the start carries the year: "Jan 27". */
export const competitionMonthLabels = (periodStart: string, periodEnd: string | null, todayIso?: string): string[] => {
  const s = firstOf(periodStart);
  const n = competitionMonthCount(periodStart, periodEnd, todayIso);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(s.getFullYear(), s.getMonth() + i, 1);
    const label = MONTH_SHORT[d.getMonth()];
    return d.getFullYear() === s.getFullYear() ? label : `${label} ${String(d.getFullYear()).slice(-2)}`;
  });
};

/** The date range the counts RPC gets: the whole period for 'overall', else that competition month clipped to the
    period (unchanged maths from the three-tab version, the offset now comes from the filter's number). */
export const competitionMonthRange = (periodStart: string, periodEnd: string | null, filter: MgrMonthFilter | string): { start: string; end: string | null } => {
  const idx = monthIndexOf(filter);
  if (idx == null) return { start: periodStart, end: periodEnd };
  const s = firstOf(periodStart);
  const rangeStart = new Date(s.getFullYear(), s.getMonth() + idx, 1);
  const rangeEnd = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 1, 0);
  const startStr = fmtDay(rangeStart);
  let endStr = fmtDay(rangeEnd);
  if (periodEnd && endStr > periodEnd) endStr = periodEnd;
  if (startStr < periodStart) return { start: periodStart, end: endStr };
  return { start: startStr, end: endStr };
};

/** A stored tab that no longer exists for this period (shorter competition, or a cache from another one) falls back
    to 'overall'. */
export const effectiveMonthFilter = (stored: string | null | undefined, monthCount: number): MgrMonthFilter => {
  const idx = monthIndexOf(stored);
  return idx != null && idx < monthCount ? (stored as MgrMonthFilter) : 'overall';
};
```

### `tests/rules/manager_months_test.js` (21 checks; copy as is, ROOT resolves to the repo root)
```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/manager_months_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Managers Leaderboard competition months (2 Nov 2026): tabs follow the period length, ranges clip to the period.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/managerMonths.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const M = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// the live competition: 1 Aug 2026 to 31 Jan 2027
eq('six months Aug to Jan', M.competitionMonthCount('2026-08-01', '2027-01-31'), 6);
eq('labels carry the year after the turn', M.competitionMonthLabels('2026-08-01', '2027-01-31'), ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan 27']);
eq('three-month competition unchanged', M.competitionMonthLabels('2026-05-01', '2026-07-31'), ['May', 'Jun', 'Jul']);
eq('ongoing with no end: to this month', M.competitionMonthCount('2026-08-01', null, '2026-11-02'), 4);
eq('ongoing labels', M.competitionMonthLabels('2026-08-01', null, '2026-11-02'), ['Aug', 'Sep', 'Oct', 'Nov']);
eq('end before start still gives one month', M.competitionMonthCount('2026-08-01', '2026-07-01'), 1);
eq('cap at 12', M.competitionMonthCount('2025-01-01', '2027-12-31'), 12);
eq('mid-month start counts that month', M.competitionMonthCount('2026-08-15', '2026-10-02'), 3);

// filters
eq('index of month4', M.monthIndexOf('month4'), 3);
eq('index of overall', M.monthIndexOf('overall'), null);
eq('index of junk', [M.monthIndexOf('month0'), M.monthIndexOf('month13'), M.monthIndexOf(''), M.monthIndexOf(null)], [null, null, null, null]);
eq('filter of index', M.monthFilterOf(3), 'month4');
eq('stored month7 on a 6-month period falls back', M.effectiveMonthFilter('month7', 6), 'overall');
eq('stored month4 on a 6-month period stays', M.effectiveMonthFilter('month4', 6), 'month4');
eq('stored month3 on a 3-month period stays', M.effectiveMonthFilter('month3', 3), 'month3');

// ranges (the same maths as the three-tab version)
eq('overall = the period', M.competitionMonthRange('2026-08-01', '2027-01-31', 'overall'), { start: '2026-08-01', end: '2027-01-31' });
eq('month1 = August', M.competitionMonthRange('2026-08-01', '2027-01-31', 'month1'), { start: '2026-08-01', end: '2026-08-31' });
eq('month4 = November', M.competitionMonthRange('2026-08-01', '2027-01-31', 'month4'), { start: '2026-11-01', end: '2026-11-30' });
eq('month6 = January, clipped to the end', M.competitionMonthRange('2026-08-01', '2027-01-15', 'month6'), { start: '2027-01-01', end: '2027-01-15' });
eq('month1 of a mid-month start begins at the start', M.competitionMonthRange('2026-08-15', '2027-01-31', 'month1'), { start: '2026-08-15', end: '2026-08-31' });
eq('ongoing month with no end stays open to the month end', M.competitionMonthRange('2026-08-01', null, 'month4'), { start: '2026-11-01', end: '2026-11-30' });

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
```

### Edited files (`git diff -U4` of the Android tree; apply the same change where iOS keeps the leaderboard query and the MgrDash screen)
```diff
diff --git a/src/lib/trainerQueries.ts b/src/lib/trainerQueries.ts
index 70d7c0e..58553d6 100644
--- a/src/lib/trainerQueries.ts
+++ b/src/lib/trainerQueries.ts
@@ -7,8 +7,9 @@ import { computeEssentials, EssentialsStatus } from './essentials';
 import { invokeWithTimeout, uploadWithTimeout, withTimeout, NET_MS } from './withTimeout';
 import { parseVoiceNotes, SessionVoiceNote } from './sessionVoiceTypes';
 import { serverNow, syncServerClock } from './managerChatQueries';
 import { ROSTER_FRESH_START_ISO } from './therapistQueries';
+import { competitionMonthLabels, competitionMonthRange, type MgrMonthFilter } from './managerMonths';
 
 /* ---------- IST helpers (mirror the web app's istDateTime) ---------- */
 const IST_OFFSET_MIN = 330;
 export const istDate = (d: Date = new Date()) =>
@@ -94,9 +95,10 @@ export type LeaderboardEntry = {
   referralCount: number;
   weightedScore: number;
   rank: number;
 };
-export type MgrMonthFilter = 'overall' | 'month1' | 'month2' | 'month3';
+// Month tabs follow the competition length since 2 Nov 2026 (src/lib/managerMonths.ts); re-exported for the screens.
+export type { MgrMonthFilter } from './managerMonths';
 export type ManagerEntry = {
   managerId: string;
   managerName: string;
   teamName: string;
@@ -116,9 +118,9 @@ export type ManagerLeaderboard = {
   entries: ManagerEntry[];
   periodStart: string;
   periodEnd: string | null;
   periodLabel: string;
-  monthLabels: [string, string, string];
+  monthLabels: string[]; // one per competition month (6 for Aug 2026 to Jan 2027), was a fixed three
 };
 
 /* ---------- Hooks ---------- */
 
@@ -1485,24 +1487,13 @@ export function useManagerTeamAppAdoption(members: { id: string; name: string; i
 // manager_score (default period = ongoing rows, else latest team_start) + month filter carved
 // from the COMPETITION start (computeMonthRange) + get_manager_team_counts RPC + profiles.
 // Aggregates exclude manager-flagged members; totalSessions = sessions + QHPs (web "Sess" figure);
 // rank by weighted = combined*0.7 + referrals*0.3.
-const mgrFmtDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
-function mgrMonthRange(periodStart: string, periodEnd: string | null, monthFilter: MgrMonthFilter): { start: string; end: string | null } {
-  if (monthFilter === 'overall') return { start: periodStart, end: periodEnd };
-  const startDate = new Date(periodStart + 'T00:00:00');
-  const monthOffset = monthFilter === 'month1' ? 0 : monthFilter === 'month2' ? 1 : 2;
-  const rangeStart = new Date(startDate.getFullYear(), startDate.getMonth() + monthOffset, 1);
-  const rangeEnd = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 1, 0); // last day of month
-  const startStr = mgrFmtDay(rangeStart);
-  let endStr = mgrFmtDay(rangeEnd);
-  if (periodEnd && endStr > periodEnd) endStr = periodEnd; // cap at period end
-  if (startStr < periodStart) return { start: periodStart, end: endStr }; // don't go before period start
-  return { start: startStr, end: endStr };
-}
+// The month maths live in managerMonths.ts (2 Nov 2026): one tab per competition month, not a fixed three.
+const mgrMonthRange = competitionMonthRange;
 export function useManagerLeaderboard(monthFilter: MgrMonthFilter = 'overall') {
   return useQuery({
-    queryKey: ['manager-leaderboard', 'v4', monthFilter], // v4: member status (18 Sep 2026); v3 rows in the persisted cache lack status / inactiveCount
+    queryKey: ['manager-leaderboard', 'v5', monthFilter], // v5: monthLabels is one per competition month (2 Nov 2026); v4: member status (18 Sep 2026)
     staleTime: 120_000,
     queryFn: async (): Promise<ManagerLeaderboard | null> => {
       const { data: allTeams, error } = await supabase.from('manager_score').select('*').order('created_at', { ascending: false });
       if (error) throw new Error(error.message);
@@ -1585,10 +1576,9 @@ export function useManagerLeaderboard(monthFilter: MgrMonthFilter = 'overall') {
       rows.sort((a, b) => b.weighted - a.weighted);
       const entries = rows.map(({ weighted, ...r }, i) => ({ ...r, rank: i + 1 }));
 
       const fmtLbl = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
-      const startD = new Date(periodStart + 'T00:00:00');
-      const monthLabels = [0, 1, 2].map((off) => new Date(startD.getFullYear(), startD.getMonth() + off, 1).toLocaleDateString('en-GB', { month: 'short' })) as [string, string, string];
+      const monthLabels = competitionMonthLabels(periodStart, periodEnd);
       return {
         entries,
         periodStart,
         periodEnd,
diff --git a/src/screens/trainer.tsx b/src/screens/trainer.tsx
index ad740dc..ede2393 100644
--- a/src/screens/trainer.tsx
+++ b/src/screens/trainer.tsx
@@ -41,8 +41,9 @@ import { ReplayMask } from '../components/ReplayShield';
 import { useAuth } from '../auth';
 import { supabase, DEV_TRAINER_ID } from '../lib/supabase';
 import { useQuery, useQueryClient } from '@tanstack/react-query';
 import { QhpAssessmentForm, CoachPresenceModal, fetchHasPriorCompletedQHP } from './qhpAssessmentForm';
+import { monthIndexOf, effectiveMonthFilter } from '../lib/managerMonths';
 import { useAddOwnSession, useTodayRoster, useTrainerStats, useTrainerProfile, useTrainerMonthSessions, useTrainerLeaderboard, useTrainerLeaderboardEssentials, useManagerLeaderboard, useManagerTeam, useManagerTeamLeaves, useManagerTeamIncidents, useManagerTeamRetention, useManagerTeamLateLogs, useManagerTeamRoster, useManagerTeamPlanOverview, useManagerTeamAcks, useManagerTeamAppAdoption, useTrainerSessionBreakdown, useTrainerReferralBreakdown, useFirstSessionAlert, istTimeParts, istDayLabel, istDate, useCancelScheduledSession, useRequestReschedule, useAddMissedRemark, lbMonthBounds, lbMonthLabel, LbBounds, RosterRow, ManagerTeamMember, MgrMonthFilter, usePlanExpiryMap, PlanExpiry, useTrainerAckSummary, useRequestRoster, useRosterDistance, SESSION_MODALITIES, useMyMonthSessionBreakdown, usePilatesRunRate } from '../lib/trainerQueries';
 import { PrevSet, useMyClients, useClientDetail, useClientSessions, useClientPlans, useClientGoals, useSaveWeeklyGoals, useDeleteWeeklyGoal, useZone2Week, useLogZone2Session, useWeeklyHealthSummary, PLAN_VALID_DAYS, useClientReports, useClientConsultAi, ClientConsultAi, useClientBioAge, useClientProgression, useCreateWorkoutSession, useModalityGate, useWorkoutTemplates, useSaveWorkoutTemplate, useDeleteWorkoutTemplate, useClientHealthCheck, useSaveHealthData, useExerciseDb, useSessionExercises, uuidv4, HealthDataInput, useWeeklyProgressionAll, ackWeeklyReport, WeeklyProgressionRow, useApprovedPlansForLogging, usePartnerInfo, usePreviousExerciseData, checkDuplicateWorkoutToday, PlanExerciseRow, useClientDailyStats, useClientWhoopRecovery, useSaveClientHomeLocation, PILATES_REFORMER_EXERCISES, usePlanEditValidation, normalizePlanModality, PLAN_EDIT_MAX_WORKOUTS } from '../lib/clientQueries';
 import * as Location from 'expo-location';
 import KvStorage from 'expo-sqlite/kv-store';
@@ -12761,18 +12762,20 @@ function initials(name: string) {
 
 export function MgrDash() {
   const { mgrDashTab, set, mgrRow } = useStore();
   const dashMgrCaps = useMyCapabilities();
-  // Month tabs are COMPETITION months carved from the period's team_start (web parity),
-  // not calendar months back from today.
-  const monthFilter: MgrMonthFilter = mgrDashTab === 'month1' || mgrDashTab === 'month2' || mgrDashTab === 'month3' ? mgrDashTab : 'overall';
-  const mgrLbQ = useManagerLeaderboard(monthFilter);
+  // Month tabs are COMPETITION months carved from the period's team_start (web parity), not calendar months back
+  // from today; one tab per month of the period since 2 Nov 2026 (six for Aug 2026 to Jan 2027). A stored tab the
+  // period does not have (an older three-month cache, or a shorter competition) falls back to Overall.
+  const storedFilter: MgrMonthFilter = monthIndexOf(mgrDashTab) != null ? (mgrDashTab as MgrMonthFilter) : 'overall';
+  const mgrLbQ = useManagerLeaderboard(storedFilter);
   const lb = mgrLbQ.data;
+  const monthLabels = lb?.monthLabels?.length ? lb.monthLabels : ['M1', 'M2', 'M3'];
+  const monthFilter = effectiveMonthFilter(mgrDashTab, monthLabels.length);
+  React.useEffect(() => { if (lb && monthFilter !== mgrDashTab) set({ mgrDashTab: monthFilter }); }, [lb, monthFilter, mgrDashTab]);
   const lbPeriods = [
     { id: 'overall', label: 'Overall' },
-    { id: 'month1', label: lb?.monthLabels?.[0] ?? 'M1' },
-    { id: 'month2', label: lb?.monthLabels?.[1] ?? 'M2' },
-    { id: 'month3', label: lb?.monthLabels?.[2] ?? 'M3' },
+    ...monthLabels.map((label, i) => ({ id: `month${i + 1}`, label })),
   ];
   const medalP = [ic.crown, ic.award, ic.award];
   const medalC = [C.gold, '#B8BCC4', '#C08A52'];
   const liveMgr = lb?.entries?.map((e) => ({
@@ -12826,10 +12829,10 @@ export function MgrDash() {
             </View>
             <Mono style={{ fontSize: 11, color: C.mono2 }}>{lb?.periodLabel ?? 'Competition period'}</Mono>
           </View>
 
-          {/* Period segmented control */}
-          <View style={{ flexDirection: 'row', gap: 6, marginTop: 16, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 4 }}>
+          {/* Period segmented control: scrolls sideways once a competition has more than three months */}
+          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16, flexGrow: 0 }} contentContainerStyle={{ flexDirection: 'row', gap: 6, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 4 }}>
             {lbPeriods.map((t) => {
               const active = mgrDashTab === t.id;
               return active ? (
                 <LinearGradient key={t.id} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 7, paddingHorizontal: 15, borderRadius: 999 }}>
@@ -12840,9 +12843,9 @@ export function MgrDash() {
                   <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>{t.label}</Text>
                 </Pressable>
               );
             })}
-          </View>
+          </ScrollView>
 
           {/* Podium */}
           <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 20, width: '100%' }}>
             {podium.map((m, i) => {
```

## 4. Check on the iPhone
1. Sign in as a manager (Sagar), open Managers Dashboard: the pill row reads Overall, Aug, Sep, Oct, Nov, Dec, Jan 27 and scrolls sideways.
2. Tap Nov: the podium and cards show November's sessions / QHPs / referrals (non-zero for active teams); Overall still shows the whole period.
3. `node tests/rules/manager_months_test.js`: ALL PASS.
4. A phone that still had `month3` remembered opens on Oct (still valid); one that somehow had `month7` opens on Overall.

Not confirmed: the Android screen was not opened on a phone after the change (tsc, the rule test and the Metro bundle pass).
