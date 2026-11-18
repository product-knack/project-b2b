# iOS handoff: the short summary every evening, the roster popup, the percent fix (18 Nov 2026)

Port of the Android change of 18 Nov 2026. Backend is shared (hub-track migration `20261118100000_weekly_summary_evening.sql` and edge function `build-client-briefing`); nothing for the app to run. An app with this change works against the server before that migration too: it then behaves as before.

## What changes for the trainer
1. **The short summary ("This week's training") is heard once per version**, not once per day. It is built every evening for the next day's sessions and again when new details arrive (a session completed, cancelled or missed, a trainer's note, nutrition / steps / water entered). A listen the evening before, from My Crew's Tomorrow's Plan, counts when the session is logged.
2. **My Crew's Tomorrow's Plan works on the plan's day**: the chip, the Who listened block, the Play rows and the recorded listens are those of the day being planned, not today's.
3. **The roster popup**: when the trainer adds a client to the plan and that day's short summary is unheard, or newer than the version they heard, the Listen now sheet opens with a headline. Two wordings. Not blocking: a Minimize button closes it and the plan goes on. While the new version is still being made the sheet says so (spinner row); minimizing does not stop the making (it happens on the server); the chip on the row reopens the Play rows. No push.
4. **The percent bar fix**: a listen from before the current build no longer counts for it, also when the server carried it forward. Before, the bar could say "Heard 100 percent, you can log" on a summary rebuilt since, while the rule line under it rightly said to listen again.

## Copy byte for byte
- `src/lib/clientHealthSummary.ts` (the pure rules, full file below).
- `tests/rules/health_summary_rules_test.js` (122 checks; `node tests/rules/health_summary_rules_test.js` must print ALL PASS).

## Server contract used
- `get_my_listen_status(p_client_ids uuid[], p_date date default null)` and `get_crew_listen_progress(p_client_ids uuid[], p_date date default null)`: the row of that training day; no day = today. The first also returns `briefing_date`, `weekly_rebuilding`, `weekly_rebuild_reason`, `weekly_changed`, `my_weekly_heard_version`. A server from before the migration answers PGRST202 to the two-argument call: call again with the list only (`rpcWithDay`). Its rows carry no `briefing_date`: then keep today's behaviour and show no popup (`dayAware`).
- `get_client_health_summary(p_client_id, p_date)`: unchanged columns; `weekly_summary` also carries `rebuilding`, `rebuild_reason`, `changed`, `previous_version`, `evening_at`.
- Listens are recorded on the row that is played (`log_summary_listen` / `log_summary_listen_progress` with the row's `briefing_date`), as the strip already does for a given day.

## Things to keep
- The popup is the existing Listen now sheet with a headline: no new modal on top of another (never sibling modals).
- One popup at a time; the same version never opens it twice by itself; after the "making" state was shown, the finished version does not open it again (`nextRosterPopup`).
- A client restored from an already shared plan opens it only for a newer version, never just for being unheard.
- Poll only while something is being made: the status every 8 s while any `weekly_rebuilding`, the strip's row every 8 s while `weekly_summary.rebuilding`.
- No em dashes in the copy. Every sentence is in the rules file.

## The other files (diffs against the Android repo before this change)

### src/lib/clientHealthSummaryQueries.ts
```diff
diff --git a/src/lib/clientHealthSummaryQueries.ts b/src/lib/clientHealthSummaryQueries.ts
index 640c5ea..eb61cf9 100644
--- a/src/lib/clientHealthSummaryQueries.ts
+++ b/src/lib/clientHealthSummaryQueries.ts
@@ -78,17 +78,15 @@ export function useLogSummaryListen(clientId: string | null | undefined) {
 
 /** My Crew (3 Nov 2026): everyone's best percent per client and summary (get_crew_listen_progress), one call per plan.
     Before the migration (PGRST202) the list is empty. */
-export function useCrewListenProgress(clientIds: string[], enabled: boolean) {
+export function useCrewListenProgress(clientIds: string[], enabled: boolean, date?: string | null) {
   const ids = [...new Set(clientIds.filter(Boolean))].sort();
   return useQuery({
-    queryKey: ['crew-listen-progress', ids.join(',')],
+    queryKey: ['crew-listen-progress', ids.join(','), date ?? 'today'],
     enabled: enabled && ids.length > 0,
     staleTime: 60_000,
     refetchOnWindowFocus: true,
     queryFn: async (): Promise<CrewListenRow[]> => {
-      const { data, error } = await withTimeout(
-        Promise.resolve((supabase.rpc as any)('get_crew_listen_progress', { p_client_ids: ids })) as Promise<{ data: any; error: any }>,
-        NET_MS, 'Who listened');
+      const { data, error } = await rpcWithDay('get_crew_listen_progress', ids, date, 'Who listened');
       if (error) {
         if (error.code === 'PGRST202' || /could not find the function/i.test(String(error.message ?? ''))) return [];
         throw new Error(friendlyError(error, 'Could not read who listened.'));
@@ -102,25 +100,36 @@ export function useCrewListenProgress(clientIds: string[], enabled: boolean) {
 }
 
 /** Prefetch the rows of a list of clients so their scripts are on the phone for an offline listen (My Crew's
-    Tomorrow's Plan, opened online). Same key as the card and the gate (today's row). */
-export async function prefetchClientHealthSummaries(qc: QueryClient, clientIds: string[]): Promise<void> {
+    Tomorrow's Plan, opened online). Same key as the card and the gate: today's row, or since 18 Nov 2026 the
+    row of the plan's day when one is given. */
+export async function prefetchClientHealthSummaries(qc: QueryClient, clientIds: string[], date?: string | null): Promise<void> {
   const ids = [...new Set(clientIds.filter(Boolean))].slice(0, 30);
-  await Promise.all(ids.map((id) => qc.prefetchQuery({ queryKey: [HEALTH_SUMMARY_KEY, id, 'today'], queryFn: () => fetchClientHealthSummary(id, null), staleTime: 60_000 }).catch(() => {})));
+  await Promise.all(ids.map((id) => qc.prefetchQuery({ queryKey: [HEALTH_SUMMARY_KEY, id, date ?? 'today'], queryFn: () => fetchClientHealthSummary(id, date ?? null), staleTime: 60_000 }).catch(() => {})));
+}
+
+/** A day-aware read (18 Nov 2026): asks for the training day's row; a server from before migration 20261118100000
+    does not know the argument (PGRST202), then the old call answers with today's row and no briefing_date. */
+async function rpcWithDay(fn: string, ids: string[], date: string | null | undefined, label: string): Promise<{ data: any; error: any }> {
+  const call = (args: Record<string, unknown>) => withTimeout(Promise.resolve((supabase.rpc as any)(fn, args)) as Promise<{ data: any; error: any }>, NET_MS, label);
+  if (!date) return call({ p_client_ids: ids });
+  const first = await call({ p_client_ids: ids, p_date: date });
+  if (first.error && (first.error.code === 'PGRST202' || /could not find the function/i.test(String(first.error.message ?? '')))) return call({ p_client_ids: ids });
+  return first;
 }
 
 /** My Crew (27 Oct 2026): the listen gate inputs for a list of clients in one call (get_my_listen_status). A client the
     caller may not listen to is missing from the map; before the migration (PGRST202) the map is empty, no chips. */
-export function useMyListenStatuses(clientIds: string[], enabled: boolean) {
+export function useMyListenStatuses(clientIds: string[], enabled: boolean, date?: string | null) {
   const ids = [...new Set(clientIds.filter(Boolean))].sort();
   return useQuery({
-    queryKey: ['listen-status', ids.join(',')],
+    queryKey: ['listen-status', ids.join(','), date ?? 'today'],
     enabled: enabled && ids.length > 0,
     staleTime: 60_000,
     refetchOnWindowFocus: true,
+    // while a new version of a short summary is being made, look again every few seconds (18 Nov 2026)
+    refetchInterval: (q) => (Object.values((q.state.data ?? {}) as Record<string, ListenStatusRow>).some((s) => s.weekly_rebuilding) ? 8000 : false),
     queryFn: async (): Promise<Record<string, ListenStatusRow>> => {
-      const { data, error } = await withTimeout(
-        Promise.resolve(supabase.rpc('get_my_listen_status', { p_client_ids: ids })) as Promise<{ data: any; error: any }>,
-        NET_MS, 'Listen status');
+      const { data, error } = await rpcWithDay('get_my_listen_status', ids, date, 'Listen status');
       if (error) {
         if (error.code === 'PGRST202' || /could not find the function/i.test(String(error.message ?? ''))) return {};
         throw new Error(friendlyError(error, 'Could not read the listen status.'));
@@ -136,6 +145,10 @@ export function useMyListenStatuses(clientIds: string[], enabled: boolean) {
           my_weekly_percent: r.my_weekly_percent == null ? null : Number(r.my_weekly_percent), my_context_percent: r.my_context_percent == null ? null : Number(r.my_context_percent),
           my_weekly_heard: typeof r.my_weekly_heard === 'boolean' ? r.my_weekly_heard : null, my_context_heard: typeof r.my_context_heard === 'boolean' ? r.my_context_heard : null,
           my_weekly_heard_at: r.my_weekly_heard_at ?? null, my_context_heard_at: r.my_context_heard_at ?? null,
+          // the training day and the roster popup's inputs (18 Nov 2026); absent before migration 20261118100000
+          briefing_date: r.briefing_date ?? null,
+          weekly_rebuilding: r.weekly_rebuilding === true, weekly_rebuild_reason: r.weekly_rebuild_reason ?? null, weekly_changed: r.weekly_changed ?? null,
+          my_weekly_heard_version: r.my_weekly_heard_version == null ? null : Number(r.my_weekly_heard_version),
         };
       }
       return out;
```

### src/components/clientHealthSummaryCard.tsx
```diff
diff --git a/src/components/clientHealthSummaryCard.tsx b/src/components/clientHealthSummaryCard.tsx
index bb7178a..c750d44 100644
--- a/src/components/clientHealthSummaryCard.tsx
+++ b/src/components/clientHealthSummaryCard.tsx
@@ -29,6 +29,7 @@ import {
   type ListenGate, type HeardMap, listenStillNeeded, listenAllHeard, LISTEN_PROCEED, LISTEN_WAIT,
   mergedProgress, progressLine, LISTEN_100_ALERT, LISTEN_OFFLINE_SAVED, LISTEN_NO_SCRIPT_OFFLINE, HEARD_PERCENT, entryPercent, entryHeard,
   type LocalListens, statusPercent, listenChipText, crewListenLines, crewLineText, type CrewListenRow,
+  changedSentence, ROSTER_POPUP_MAKING, ROSTER_POPUP_MINIMIZE,
 } from '../lib/clientHealthSummary';
 
 const GOLD = C.gold;
@@ -37,7 +38,7 @@ const CONTEXT = '#8FB4FF';
 const colorOf = (which: Which) => (which === 'weekly' ? WEEKLY : CONTEXT);
 const iconOf = (which: Which): IconName => (which === 'weekly' ? 'activity' : 'stethoscope');
 const nothingYet = (which: Which) =>
-  which === 'weekly' ? 'Built nightly at 11:59 PM; nothing yet for this client.' : 'Built when a QHP, blood or medical report arrives; nothing yet.';
+  which === 'weekly' ? 'Built every evening for the next day; nothing yet for this client.' : 'Built when a QHP, blood or medical report arrives; nothing yet.';
 
 const subLine = (row: ClientHealthSummaryRow | null, which: Which): string => {
   const s = summaryOf(row, which);
@@ -361,6 +362,15 @@ export function ClientSummaryStrip({ clientId, date, accent = GOLD, latest = fal
   const gate = listenGate(row, uid, Date.now(), local);
   const due = gateDue(gate);
   React.useEffect(() => { if (!open) voice.stop(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
+  // New details arrived and the server is making a new version (18 Nov 2026): read the row again every few
+  // seconds until it is there. Closing the strip or the sheet does not stop the making, only this watching.
+  const rebuilding = !!row?.weekly_summary?.rebuilding;
+  const refetchRow = q.refetch;
+  React.useEffect(() => {
+    if (!rebuilding || !online) return;
+    const t = setInterval(() => { refetchRow(); }, 8000);
+    return () => clearInterval(t);
+  }, [rebuilding, online, refetchRow]);
   if (!clientId || q.isError) return null;
   const hasWeekly = hasScript(row, 'weekly'), hasContext = hasScript(row, 'context');
   const summaryLine = q.isLoading ? 'Loading…' : !row || (!hasWeekly && !hasContext) ? (!online ? LISTEN_NO_SCRIPT_OFFLINE((clientName ?? '').split(' ')[0] || 'this client') : 'Nothing built yet for this day') : [hasWeekly ? `This week · ${durationText(row!.weekly_summary!.script)}` : null, hasContext ? `Health context · ${durationText(row!.context_summary!.script)}` : null].filter(Boolean).join('   ');
@@ -391,6 +401,12 @@ export function ClientSummaryStrip({ clientId, date, accent = GOLD, latest = fal
         {open ? (
           <View style={{ paddingHorizontal: 10, paddingBottom: 10, gap: 8 }}>
             <Body style={{ fontSize: 10.5, color: due ? '#FF9B8F' : C.muted2, lineHeight: 15 }}>{LISTEN_WHY}</Body>
+            {rebuilding ? (
+              <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: hexA(GOLD, 0.08), borderWidth: 1, borderColor: hexA(GOLD, 0.3) }}>
+                <ActivityIndicator size="small" color={GOLD} />
+                <Body style={{ flex: 1, fontSize: 11, color: GOLD, lineHeight: 15.5 }}>{`${changedSentence(row?.weekly_summary?.rebuild_reason) || 'New details came in.'} A new version of this week's training is being made. The one below is the earlier version.`}</Body>
+              </View>
+            ) : null}
             {(['weekly', 'context'] as Which[]).map((which) => (
               <SummaryRow key={which} which={which} row={row} uid={uid} {...rowVoiceProps(voice, which)} transcriptOpen={transcript === which}
                 rule={listenRuleLine(which, gate[which], clientName)} ruleDue={gate[which] === 'due'}
@@ -419,8 +435,8 @@ export function ClientSummaryStrip({ clientId, date, accent = GOLD, latest = fal
 const gateStatus = (which: Which, state: GateState, heardNow: boolean, row: ClientHealthSummaryRow | null): { text: string; color: string } => {
   if (state === 'none') return { text: 'Nothing to hear yet', color: C.muted2 };
   if (heardNow) return { text: 'Heard just now', color: C.green };
-  if (state === 'done') return { text: which === 'weekly' ? 'Heard today' : 'Up to date', color: C.green };
-  if (which === 'weekly') return { text: 'Due today', color: C.red };
+  if (state === 'done') return { text: which === 'weekly' ? 'Heard' : 'Up to date', color: C.green };
+  if (which === 'weekly') return { text: 'Not heard yet', color: C.red };
   const built = fmtStamp(generatedAtOf(row, 'context'));
   return { text: built ? `New report · ${built}` : 'Not heard yet', color: C.red };
 };
@@ -492,7 +508,7 @@ export function ListenGateSheet({ visible, clientId, clientName, onContinue }: {
             </View>
             <View style={{ flex: 1 }}>
               <Serif style={{ fontSize: 20 }}>Listen before you log</Serif>
-              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 3, lineHeight: 16 }}>{LISTEN_WHY} This week's training changes every day; the health context changes when a new report arrives. Hear each one to the end, then tap Proceed to workout.</Body>
+              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 3, lineHeight: 16 }}>{LISTEN_WHY} This week's training is made new every evening and when new details come in; the health context changes when a new report arrives. Hear each one to the end, then tap Proceed to workout.</Body>
             </View>
           </View>
           <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingBottom: 8 }}>
@@ -545,7 +561,9 @@ export function ListenStatusChip({ status, onPress, compact = false, local }: {
   );
 }
 
-export type ListenNowInfo = { id: string; name: string; when?: 'tomorrow' | 'today' } | null;
+/** date (18 Nov 2026): the training day whose summaries are played (My Crew's plan day); none = today's.
+    headline: the roster popup's words in place of "Listen now"; making = the new version is still being made. */
+export type ListenNowInfo = { id: string; name: string; when?: 'tomorrow' | 'today'; date?: string | null; headline?: { title: string; body: string; making: boolean } | null } | null;
 
 /** My Crew's "Who listened" block (3 Nov 2026): every crew member's percent for both summaries of this client. */
 export function CrewListenBlock({ clientId, rows, members, loading }: { clientId: string; rows: CrewListenRow[]; members: { id: string; name: string }[]; loading?: boolean }) {
@@ -593,8 +611,8 @@ export function ListenNowSheet({ info, onClose, crewRows, members, crewLoading }
                 <Icon name="headphones" size={18} color="#FF9B8F" strokeWidth={2.1} />
               </View>
               <View style={{ flex: 1 }}>
-                <Serif style={{ fontSize: 19 }}>Listen now</Serif>
-                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2, lineHeight: 16 }}>{info ? listenNowLine(info.name, info.when ?? 'tomorrow') : ''}</Body>
+                <Serif style={{ fontSize: 19 }}>{info?.headline?.title || 'Listen now'}</Serif>
+                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2, lineHeight: 16 }}>{info ? (info.headline?.body || listenNowLine(info.name, info.when ?? 'tomorrow')) : ''}</Body>
               </View>
               <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                 <Icon name="close" size={14} color={C.muted} strokeWidth={2.3} />
@@ -602,8 +620,20 @@ export function ListenNowSheet({ info, onClose, crewRows, members, crewLoading }
             </View>
             <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 6 }}>
               {info && crewRows ? <CrewListenBlock clientId={info.id} rows={crewRows} members={members ?? []} loading={crewLoading} /> : null}
-              {info ? <ClientSummaryStrip clientId={info.id} clientName={info.name} accent={GOLD} defaultOpen /> : null}
+              {info?.headline?.making ? (
+                <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: hexA(GOLD, 0.08), borderWidth: 1, borderColor: hexA(GOLD, 0.32) }}>
+                  <ActivityIndicator size="small" color={GOLD} />
+                  <Body style={{ flex: 1, fontSize: 11.5, color: GOLD, lineHeight: 16.5 }}>{ROSTER_POPUP_MAKING}</Body>
+                </View>
+              ) : null}
+              {info ? <ClientSummaryStrip clientId={info.id} clientName={info.name} date={info.date ?? null} accent={GOLD} defaultOpen /> : null}
             </ScrollView>
+            {info?.headline ? (
+              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={ROSTER_POPUP_MINIMIZE}
+                style={{ marginTop: 12, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }}>
+                <Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: '#fff' }}>{ROSTER_POPUP_MINIMIZE}</Text>
+              </Pressable>
+            ) : null}
           </View>
         </ReplayMask>
       </View>
```

### src/screens/managerChat.tsx
```diff
diff --git a/src/screens/managerChat.tsx b/src/screens/managerChat.tsx
index c0d6fa3..a5f6b7f 100644
--- a/src/screens/managerChat.tsx
+++ b/src/screens/managerChat.tsx
@@ -29,6 +29,7 @@ import { useClientsLatestVoiceNotes } from '../lib/sessionVoiceQueries';
 import { ListenStatusChip, ListenNowSheet, type ListenNowInfo } from '../components/clientHealthSummaryCard';
 import { listenChipShown } from '../lib/clientHealthSummary';
 import { useMyListenStatuses, useCrewListenProgress, prefetchClientHealthSummaries } from '../lib/clientHealthSummaryQueries';
+import { gateFromStatus, rosterPopupKind, nextRosterPopup, rosterPopupText, type RosterPopupKind } from '../lib/clientHealthSummary';
 import { useLocalListensMap } from '../lib/listenLocal';
 import { useIsOnline } from '../lib/offline';
 import { friendlyError } from '../lib/friendlyError';
@@ -1452,21 +1453,51 @@ function TomorrowPlanSheet({ visible, onClose, onSend, sending, existing, addOnl
   // The client's latest session voice notes (30 Sep 2026): hear what was said after her last workout.
   const latestVoiceQ = useClientsLatestVoiceNotes(rows.map((r) => r.clientId), visible);
   // The listen rule on each row (27 Oct 2026): one batched read, the chip opens the Listen now sheet.
-  const listenQ = useMyListenStatuses(rows.map((r) => r.clientId), visible);
+  // Since 18 Nov 2026 the status, the Play rows and the listens are those of the PLAN's day (the short summary
+  // is built every evening for the next day), so a listen here counts when the session is logged. A server from
+  // before migration 20261118100000 answers with today's row and no day: then everything stays as it was.
+  const planDay = composeQ.data?.date ?? null;
+  const listenQ = useMyListenStatuses(rows.map((r) => r.clientId), visible, planDay);
   const listenById = listenQ.data ?? {};
-  const [listenFor, setListenFor] = React.useState<ListenNowInfo>(null);
+  const dayAware = Object.values(listenById).some((s) => !!s.briefing_date);
+  const listenDay = dayAware ? planDay : null;
+  const [listenFor, setListenFor] = React.useState<{ id: string; name: string; popup: RosterPopupKind | null } | null>(null);
   // Listen progress (3 Nov 2026): the phone's own records (offline listens count at once), everyone's percent for the
   // Who listened block, and the rows prefetched while online so tomorrow's summaries can be heard offline.
   const listenLocal = useLocalListensMap(rows.map((r) => r.clientId));
-  const crewListenQ = useCrewListenProgress(rows.map((r) => r.clientId), visible);
+  const crewListenQ = useCrewListenProgress(rows.map((r) => r.clientId), visible, listenDay);
   const qcListen = useQueryClient();
   const onlineForPrefetch = useIsOnline();
   const crewTeamQ = useMyManagerTeam(); // cached: the chat screen reads the same query
   const crewMembers = (crewTeamQ.data?.members ?? []).map((m) => ({ id: m.id, name: m.name }));
   React.useEffect(() => {
     if (!visible || !onlineForPrefetch || !rows.length) return;
-    prefetchClientHealthSummaries(qcListen, rows.map((r) => r.clientId));
-  }, [visible, onlineForPrefetch, rows.map((r) => r.clientId).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
+    prefetchClientHealthSummaries(qcListen, rows.map((r) => r.clientId), listenDay);
+  }, [visible, onlineForPrefetch, listenDay, rows.map((r) => r.clientId).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
+  /* The roster popup (18 Nov 2026, owner): when a client is added to the plan and the short summary of that day
+     is unheard, or newer than the version this trainer heard, a popup says so and offers to listen now. Not
+     blocking: Minimize closes it and the plan goes on; while the new version is still being made it says so, and
+     minimizing does not stop the making (it happens on the server). The chip on the row reopens the Play rows.
+     A client restored from an already shared plan opens it only for a NEWER version (new details), never just
+     for being unheard, so reopening a plan of eight clients is not eight popups. Once per client and version; and
+     after the trainer saw (and minimized) the "making" state, the finished version does not open it again by itself:
+     the chip on the row reopens it (owner: "when it is ready, the trainer can reopen it from the Play row"). */
+  const popupShown = React.useRef<Map<string, string>>(new Map()); // client id -> the popup key last shown
+  const [askFor, setAskFor] = React.useState<string[]>([]); // client ids just added by the trainer, waiting for their status
+  React.useEffect(() => { if (!visible) { popupShown.current = new Map(); setAskFor([]); setListenFor(null); } }, [visible]);
+  React.useEffect(() => {
+    if (!visible || !dayAware || listenFor) return;
+    const d = nextRosterPopup({
+      added: askFor,
+      selected: [...sel.keys()],
+      statuses: listenById,
+      kindOf: (cid) => rosterPopupKind(listenById[cid], gateFromStatus(listenById[cid], Date.now(), listenLocal[cid])),
+      lastShown: Object.fromEntries(popupShown.current),
+    });
+    for (const [cid, key] of Object.entries(d.shown)) popupShown.current.set(cid, key);
+    if (d.consumed.length) setAskFor((list) => list.filter((x) => !d.consumed.includes(x)));
+    if (d.open) setListenFor({ id: d.open.clientId, name: rows.find((r) => r.clientId === d.open!.clientId)?.name ?? '', popup: d.open.kind });
+  }, [visible, dayAware, listenFor, askFor, sel, listenById, listenLocal]); // eslint-disable-line react-hooks/exhaustive-deps
   const latestVoice = latestVoiceQ.data ?? {};
   const [voiceFor, setVoiceFor] = React.useState<LatestVoiceInfo>(null);
   // Expired-plan gate (27 Oct 2026): one batched read; a selected row whose plan for the picked modality is
@@ -1509,6 +1540,7 @@ function TomorrowPlanSheet({ visible, onClose, onSend, sending, existing, addOnl
       else { next.set(cid, { time: slotTime ?? '07:00', modality: lastModality }); if (!slotTime) setTimeFor(cid); }
       return next;
     });
+    if (!sel.has(cid)) setAskFor((a) => (a.includes(cid) ? a : [...a, cid])); // just added: the roster popup looks at this client
   };
   const send = () => {
     if (!composeQ.data || !count || sending) return;
@@ -1607,7 +1639,7 @@ function TomorrowPlanSheet({ visible, onClose, onSend, sending, existing, addOnl
         {hasChips ? (
           <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingLeft: 42, paddingRight: 11, paddingBottom: 10 }}>
               {latestVoice[r.clientId] ? <LatestVoiceChip compact latest={latestVoice[r.clientId]} onPress={() => setVoiceFor({ name: r.name, latest: latestVoice[r.clientId] })} /> : null}
-              <ListenStatusChip compact status={listenById[r.clientId]} local={listenLocal[r.clientId]} onPress={() => setListenFor({ id: r.clientId, name: r.name })} />
+              <ListenStatusChip compact status={listenById[r.clientId]} local={listenLocal[r.clientId]} onPress={() => setListenFor({ id: r.clientId, name: r.name, popup: null })} />
               {cycles[r.clientId] ? <CycleChip cycle={cycles[r.clientId]} onPress={() => setCycleFor({ name: r.name, cycle: cycles[r.clientId] })} /> : null}
               {essentials[r.clientId] ? <EssentialsBadge status={essentials[r.clientId]} compact /> : null}
               {protocols[r.clientId] ? <ProtocolChip onPress={() => setProtoFor({ name: r.name, proto: protocols[r.clientId] })} /> : null}
@@ -1701,7 +1733,9 @@ function TomorrowPlanSheet({ visible, onClose, onSend, sending, existing, addOnl
       <ProtocolPopup info={protoFor} onClose={() => setProtoFor(null)} />
       <CyclePopup info={cycleFor} onClose={() => setCycleFor(null)} />
       <LatestVoicePopup info={voiceFor} onClose={() => setVoiceFor(null)} />
-      <ListenNowSheet info={listenFor} onClose={() => { setListenFor(null); listenQ.refetch(); crewListenQ.refetch(); }}
+      <ListenNowSheet
+        info={listenFor ? { id: listenFor.id, name: listenFor.name, date: listenDay, headline: listenFor.popup ? rosterPopupText(listenFor.popup, listenById[listenFor.id], listenFor.name) : null } : null}
+        onClose={() => { setListenFor(null); listenQ.refetch(); crewListenQ.refetch(); }}
         crewRows={crewListenQ.data ?? []} crewLoading={crewListenQ.isLoading} members={crewMembers} />
     </Modal>
   );
```

## src/lib/clientHealthSummary.ts (full file)
```ts
/* "Listen before the session" (9 Oct 2026): pure rules for the spoken client
   summaries and the listen gate. Backend shared with the web (hub-track
   migrations 20261009100000 / 110000 / 120000): one client_health_summary row
   per client, rebuilt by edge functions; the device speaks the script, nothing
   is stored as audio. Shapes follow docs/client-health-summary-handoff.md. */

export type Which = 'weekly' | 'context';

export type ListenEntry = {
  at: string;
  by: string;
  by_name?: string | null;
  role?: string | null;
  which: Which;
  version?: number | null;
  /** Progress (3 Nov 2026): the best percent of this listen; absent on a legacy play (counts as heard). */
  percent?: number | null;
  heard?: boolean | null;
  heard_at?: string | null;
  carried?: boolean | null;
  briefing_date?: string | null;
};

export type WeeklySummary = {
  generated_at?: string | null;
  window_from?: string | null;
  window_to?: string | null;
  script: string;
  highlights?: string[] | null;
  version?: number | null;
  fallback?: boolean | null;
  fallback_reason?: string | null;
  facts?: Record<string, unknown> | null;
  /** 18 Nov 2026 (server migration 20261118100000): new details arrived and a newer version is being made. */
  rebuilding?: boolean | null;
  /** Why it is being remade ("a session was completed, a trainer added a note"). */
  rebuild_reason?: string | null;
  /** What changed in THIS version compared with the one before; null for the evening build. */
  changed?: string | null;
  previous_version?: number | null;
  /** When the evening build (the week up to that evening) ran for this training day. */
  evening_at?: string | null;
};

export type ContextFinding = {
  key?: string | null;
  label?: string | null;
  text?: string | null;
  value?: unknown;
  previous?: unknown;
  unit?: string | null;
  date?: string | null;
};

export type ContextSummary = {
  generated_at?: string | null;
  script: string;
  sources?: { type: string; id?: string | null; date?: string | null; label?: string | null }[] | null;
  improved?: ContextFinding[] | null;
  worsened?: ContextFinding[] | null;
  watch?: ContextFinding[] | null;
  medical_events?: { text?: string | null; date?: string | null; days_ago?: number | null; ongoing?: boolean | null }[] | null;
  exclusions_confirmed?: boolean | null;
  version?: number | null;
  fallback?: boolean | null;
  fallback_reason?: string | null;
};

export type ClientHealthSummaryRow = {
  client_id: string;
  weekly_summary: WeeklySummary | null;
  /** since 10 Oct 2026 the row is one per training day; these two mirror the summaries' own generated_at */
  weekly_generated_at: string | null;
  context_summary: ContextSummary | null;
  context_generated_at: string | null;
  context_dirty: boolean | null;
  listen_history: ListenEntry[] | null;
  /** the training day this row is for (YYYY-MM-DD IST); the row in effect for the date asked */
  briefing_date?: string | null;
  status?: 'building' | 'ready' | null;
  built_at?: string | null;
};

export const TITLES: Record<Which, string> = { weekly: "This week's training", context: 'Health context' };

/** About 2.4 spoken words a second (the web card's estimate). */
export const WORDS_PER_SECOND = 2.4;
export const scriptWords = (script: string | null | undefined): number =>
  (script ?? '').trim().split(/\s+/).filter(Boolean).length;
export const durationText = (script: string | null | undefined): string => {
  const secs = Math.round(scriptWords(script) / WORDS_PER_SECOND);
  return secs < 60 ? `${secs} sec` : `${Math.floor(secs / 60)} min ${secs % 60} sec`;
};

const stampFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
/** "9 Oct, 2:15 pm" in IST; the raw string when unparsable. */
export const fmtStamp = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return iso;
  return stampFmt.format(new Date(t)).replace(/\s?(am|pm)$/i, (m) => m.toLowerCase());
};

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
/** 'YYYY-MM-DD' of an instant in IST. */
export const istDayOf = (isoOrMs: string | number): string => dayFmt.format(new Date(isoOrMs));

export const historyOf = (row: ClientHealthSummaryRow | null | undefined): ListenEntry[] =>
  Array.isArray(row?.listen_history) ? (row!.listen_history as ListenEntry[]).filter((h) => h && typeof h.at === 'string') : [];

export const summaryOf = (row: ClientHealthSummaryRow | null | undefined, which: Which): WeeklySummary | ContextSummary | null =>
  which === 'weekly' ? row?.weekly_summary ?? null : row?.context_summary ?? null;

export const generatedAtOf = (row: ClientHealthSummaryRow | null | undefined, which: Which): string | null =>
  which === 'weekly'
    ? row?.weekly_generated_at ?? row?.weekly_summary?.generated_at ?? null
    : row?.context_generated_at ?? row?.context_summary?.generated_at ?? null;

export const hasScript = (row: ClientHealthSummaryRow | null | undefined, which: Which): boolean =>
  !!summaryOf(row, which)?.script?.trim();

/* ---------- Listen progress (3 Nov 2026) ----------
   Owner: "show everyone in percent how much they listened, and an alert to listen to 100 percent so the session
   log needs no second listen; 95 percent and above counts as 100". A trail entry now carries percent / heard; an
   entry WITHOUT a percent key is a play from before this rule and counts as heard. */
export const HEARD_PERCENT = 95;
export const entryPercent = (e: ListenEntry | null | undefined): number =>
  !e ? 0 : e.percent == null ? 100 : Math.max(0, Math.min(100, Math.round(Number(e.percent) || 0)));
export const entryHeard = (e: ListenEntry | null | undefined): boolean => !!e && (e.percent == null ? true : entryPercent(e) >= HEARD_PERCENT);
/** The moment an entry counts as heard: heard_at when the server stamped it, else its at. */
export const entryHeardAt = (e: ListenEntry): string => e.heard_at ?? e.at;

/** The signed-in user's newest listen of that kind (the trail is oldest first). */
export const myLastListen = (history: ListenEntry[], which: Which, uid: string | null | undefined): ListenEntry | null => {
  if (!uid) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.which === which && h.by === uid) return h;
  }
  return null;
};
/** The signed-in user's newest HEARD listen of that kind (percent at or above the threshold, or a legacy play). */
export const myLastHeard = (history: ListenEntry[], which: Which, uid: string | null | undefined): ListenEntry | null => {
  if (!uid) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.which === which && h.by === uid && entryHeard(h)) return h;
  }
  return null;
};
/** The signed-in user's best percent for the CURRENT build of that kind (0 when nothing since the build). */
export const myProgress = (row: ClientHealthSummaryRow | null | undefined, which: Which, uid: string | null | undefined): number => {
  const g = generatedAtOf(row, which);
  if (!uid || !g) return 0;
  const built = new Date(g).getTime();
  let best = 0;
  for (const h of historyOf(row)) {
    if (h.which !== which || h.by !== uid) continue;
    // 18 Nov 2026: a listen from before this build is a listen of an OLDER version, also when the server
    // carried it forward. (It used to count, so the bar said "Heard 100 percent, you can log" on a summary
    // rebuilt since, while the rule line under it rightly said to listen again.)
    if (new Date(h.at).getTime() < built) continue;
    best = Math.max(best, entryPercent(h));
  }
  return best;
};

/** Anyone's newest listen of that kind. */
export const lastListen = (history: ListenEntry[], which: Which): ListenEntry | null => {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].which === which) return history[i];
  return null;
};

/** "New since you listened": built after the signed-in user's last listen, or never listened. */
export const isNewSince = (row: ClientHealthSummaryRow | null | undefined, which: Which, uid: string | null | undefined): boolean => {
  const g = generatedAtOf(row, which);
  if (!hasScript(row, which) || !g) return false;
  const mine = myLastListen(historyOf(row), which, uid);
  return !mine || new Date(mine.at).getTime() < new Date(g).getTime();
};

/* ---------- Listen gate (user, 9 Oct 2026) ----------
   A session logged from Today's Roster first needs the summaries heard:
   - This week's training: heard after its latest build. Since 18 Nov 2026 it is built every evening for the
     next day's sessions and again when new details arrive (a session completed, cancelled or missed, a
     trainer's note, nutrition / steps / water entered), so the rule is once per version: a listen the
     evening before, from My Crew's Tomorrow's Plan, counts on the session day. (Until then: heard on the
     same IST day as today, because it was rebuilt every night.)
   - Health context ("weekly wala jab bhi new report se update ho"): heard after
     its latest build, whenever a new report rebuilt it.
   A summary that does not exist cannot be required ('none').
   24 Oct 2026: the server keeps the context's generated_at until a real update and
   get_client_health_summary carries each person's newest earlier-day context listen
   (carried: true), so the context is heard once per update, not once per day. */
export type GateState = 'none' | 'done' | 'due';

/** Since 3 Nov 2026 only a HEARD listen (95 percent or more, or a legacy play) can make a summary done; `local`
    is the phone's own record for the current build (an offline listen not yet synced), merged in by the caller. */
export const gateStateFor = (row: ClientHealthSummaryRow | null | undefined, which: Which, uid: string | null | undefined, nowMs: number = Date.now(), local?: LocalListen | null): GateState => {
  const g = generatedAtOf(row, which);
  if (!hasScript(row, which) || !g) return 'none';
  const built = new Date(g).getTime();
  const mine = myLastHeard(historyOf(row), which, uid);
  const ok = (atIso: string): boolean => {
    const heardAt = new Date(atIso).getTime();
    return isFinite(heardAt) && heardAt >= built;
  };
  if (mine && ok(entryHeardAt(mine))) return 'done';
  const v = summaryOf(row, which)?.version ?? null;
  if (local && local.which === which && local.heard && local.heardAt && (local.version == null || v == null || local.version === v) && local.generatedAt === g && ok(local.heardAt)) return 'done';
  return 'due';
};

export type ListenGate = { weekly: GateState; context: GateState };
/** The phone's own record of one listen (listenLocal.ts): what this phone heard of a build, synced or not. */
export type LocalListen = {
  clientId: string;
  which: Which;
  version: number | null;
  /** The build this record is for (generated_at); another build means a new summary, the record no longer counts. */
  generatedAt: string | null;
  briefingDate: string | null;
  percent: number;
  heard: boolean;
  heardAt: string | null;
  at: string;
  synced: boolean;
};
export type LocalListens = Partial<Record<Which, LocalListen | null>>;
export const listenGate = (row: ClientHealthSummaryRow | null | undefined, uid: string | null | undefined, nowMs: number = Date.now(), local?: LocalListens | null): ListenGate => ({
  weekly: gateStateFor(row, 'weekly', uid, nowMs, local?.weekly ?? null),
  context: gateStateFor(row, 'context', uid, nowMs, local?.context ?? null),
});

/** The percent to show for one row: the server's best for the current build merged with the phone's record. */
export const mergedProgress = (row: ClientHealthSummaryRow | null | undefined, which: Which, uid: string | null | undefined, local?: LocalListen | null): number => {
  const server = myProgress(row, which, uid);
  const g = generatedAtOf(row, which);
  const mine = local && local.which === which && local.generatedAt === g ? local.percent : 0;
  return Math.max(server, mine);
};
/** The lines under a Play row's progress bar (owner's words, 3 Nov 2026). */
export const LISTEN_100_ALERT = 'Listen to 100 percent now, so you do not have to listen again when you log the session.';
export const LISTEN_100_OK = 'Heard 100 percent, you can log.';
export const progressLine = (percent: number): string => (percent >= HEARD_PERCENT ? LISTEN_100_OK : `You: ${Math.max(0, Math.min(100, Math.round(percent)))} percent heard`);
export const LISTEN_OFFLINE_SAVED = 'Saved on this phone · syncs when online';
export const LISTEN_NO_SCRIPT_OFFLINE = (first: string) => `Connect once to load ${first}'s summaries.`;
export const gateDue = (g: ListenGate): boolean => g.weekly === 'due' || g.context === 'due';

/* ---------- The rule, written once (27 Oct 2026) ----------
   Owner: "add the rule everywhere so the trainer knows why it matters and cannot log without it". Every
   surface with the two Play rows (Today's Roster strip, the Log Health Data popup, the client page, the gate
   sheet, My Crew) shows the same header and the same line under each row. */
export const LISTEN_WHY = 'Each summary must be heard once after it changes, or Submit stays off.';
export const LISTEN_HEADER_DUE = 'NOT HEARD · LISTEN NOW';
export const LISTEN_HEADER_OK = 'CLIENT SUMMARIES';
export const listenHeaderText = (g: ListenGate): string => (gateDue(g) ? LISTEN_HEADER_DUE : LISTEN_HEADER_OK);

/** The line under a Play row. Null when that summary does not exist. */
export const listenRuleLine = (which: Which, state: GateState, clientFirstName?: string | null): string | null => {
  const name = (clientFirstName ?? '').trim().split(/\s+/)[0] || 'this client';
  if (state === 'none') return null;
  if (state === 'done') return 'Heard after the latest update. You can log.';
  return which === 'context'
    ? `Listen to this at least once. It changed since you last heard it. You cannot log a workout for ${name} until you do.`
    : `Listen to this once after its latest update. You cannot log ${name}'s workout until you do.`;
};

/** My Crew: the chip on a client row and the sentence in the Listen now sheet. */
export const LISTEN_CHIP_DUE = 'NOT HEARD · LISTEN NOW';
export const LISTEN_CHIP_OK = 'HEARD';
/** The short form for crowded rows (Tomorrow's Plan, 30 Oct 2026); the chip's accessibility label keeps the full sense. */
export const LISTEN_CHIP_DUE_SHORT = 'NOT HEARD';
export const listenNowLine = (clientFirstName: string | null | undefined, when: 'tomorrow' | 'today' = 'tomorrow'): string =>
  `You have not heard ${(clientFirstName ?? '').trim().split(/\s+/)[0] || 'this client'}'s summaries. You cannot log ${when}'s session without this. Listen now.`;

/* ---------- The roster popup (18 Nov 2026) ----------
   Owner: "when a trainer makes the roster from My Crew show a popup: some new details were found, so we made
   a new summary and you have to listen to this now"; shown in both cases, a newer version than the one heard
   and a short summary never heard, with different words; NOT blocking: a Minimize button, a "making it" state
   while the new version is being built that minimizing does not stop, reopened from the Play row; the listen
   sheet before logging stays the backstop on the session day. Only the short summary opens it. */
export type RosterPopupKind = 'none' | 'new_version' | 'unheard';
export const rosterPopupKind = (s: ListenStatusRow | null | undefined, gate: ListenGate): RosterPopupKind => {
  if (!s) return 'none';
  const heardEarlier = s.my_weekly_heard_version != null;
  if (s.weekly_rebuilding) return heardEarlier || gate.weekly === 'done' ? 'new_version' : s.has_weekly ? 'unheard' : 'none';
  if (!s.has_weekly || gate.weekly !== 'due') return 'none';
  return heardEarlier ? 'new_version' : 'unheard';
};
/** One popup per client, per day and per version: the same version never opens it twice by itself. */
export const rosterPopupKey = (s: ListenStatusRow | null | undefined): string =>
  !s ? '' : `${s.client_id}|${s.briefing_date ?? ''}|${s.weekly_rebuilding ? 'making' : s.weekly_version ?? ''}`;
/** "a session was completed, a trainer added a note" -> "A session was completed, a trainer added a note." */
export const changedSentence = (reason: string | null | undefined): string => {
  const r = (reason ?? '').replace(/\s+/g, ' ').trim().replace(/[.]+$/, '');
  return r ? `${r.charAt(0).toUpperCase()}${r.slice(1)}.` : '';
};
/** Which popup to open next in My Crew's plan sheet, if any (the sheet applies the answer; nothing here touches the screen).
    added: clients the trainer just added to the plan, in order: either case opens it.
    selected: every client on the plan (a restored plan too): only a NEWER version than the one heard opens it.
    lastShown: client id -> the key of the popup last shown for that client in this sheet. The same key never opens
    twice, and after the "making" state was shown the finished version does not open it again (the chip does).
    consumed: the added clients whose status was there and who are done with (opened or nothing to show). */
export const nextRosterPopup = (o: {
  added: string[];
  selected: string[];
  statuses: Record<string, ListenStatusRow | null | undefined>;
  kindOf: (clientId: string) => RosterPopupKind;
  lastShown: Record<string, string | undefined>;
}): { open: { clientId: string; kind: RosterPopupKind } | null; consumed: string[]; shown: Record<string, string> } => {
  const shown: Record<string, string> = {};
  const consumed: string[] = [];
  const seen = (cid: string): boolean => {
    const key = rosterPopupKey(o.statuses[cid]);
    const last = shown[cid] ?? o.lastShown[cid];
    if (last === key) return true;
    if (last && last.endsWith('|making') && !key.endsWith('|making')) { shown[cid] = key; return true; }
    return false;
  };
  for (const cid of o.added) {
    if (!o.statuses[cid]) continue; // its status is not here yet: look again when it is
    consumed.push(cid);
    const kind = o.kindOf(cid);
    if (kind !== 'none' && o.selected.includes(cid) && !seen(cid)) {
      shown[cid] = rosterPopupKey(o.statuses[cid]);
      return { open: { clientId: cid, kind }, consumed, shown };
    }
  }
  for (const cid of o.selected) {
    if (!o.statuses[cid] || (o.added.includes(cid) && !consumed.includes(cid))) continue;
    if (o.kindOf(cid) === 'new_version' && !seen(cid)) {
      shown[cid] = rosterPopupKey(o.statuses[cid]);
      return { open: { clientId: cid, kind: 'new_version' }, consumed, shown };
    }
  }
  return { open: null, consumed, shown };
};
export const ROSTER_POPUP_MINIMIZE = 'Minimize';
export const ROSTER_POPUP_MAKING = 'Making the new summary. It takes about a minute. You can minimize this and carry on; it will be on the Play row when it is ready.';
export const rosterPopupText = (kind: RosterPopupKind, s: ListenStatusRow | null | undefined, clientFirstName: string | null | undefined, when: 'tomorrow' | 'today' = 'tomorrow'): { title: string; body: string; making: boolean } => {
  const name = (clientFirstName ?? '').trim().split(/\s+/)[0] || 'this client';
  const making = !!s?.weekly_rebuilding;
  if (kind === 'new_version') {
    const what = changedSentence(making ? s?.weekly_rebuild_reason : s?.weekly_changed);
    return {
      title: `New details for ${name}`,
      body: making
        ? `${what ? `Since you listened: ${what}` : 'New details came in since you listened.'} We are making a new summary.`
        : `${what ? `Since you listened: ${what}` : 'The summary was updated since you listened.'} We made a new summary. Listen to it now.`,
      making,
    };
  }
  if (kind === 'unheard') {
    return { title: `Listen to ${name}'s summary`, body: `You have not heard ${name}'s summary for ${when} yet. Listen to it now, so you do not have to when you log the session.`, making };
  }
  return { title: '', body: '', making: false };
};

/** One row of get_my_listen_status (a batched read for My Crew): the same gate, computed from flat fields.
    Since 3 Nov 2026 the heard columns decide; the old my_last_*_at columns stay for older builds. */
export type ListenStatusRow = {
  client_id: string;
  has_weekly: boolean;
  has_context: boolean;
  weekly_generated_at: string | null;
  context_generated_at: string | null;
  my_last_weekly_at: string | null;
  my_last_context_at: string | null;
  weekly_version?: number | null;
  context_version?: number | null;
  my_weekly_percent?: number | null;
  my_context_percent?: number | null;
  my_weekly_heard?: boolean | null;
  my_context_heard?: boolean | null;
  my_weekly_heard_at?: string | null;
  my_context_heard_at?: string | null;
  /** 18 Nov 2026: the training day the status is for (My Crew asks for the plan's day). */
  briefing_date?: string | null;
  weekly_rebuilding?: boolean | null;
  weekly_rebuild_reason?: string | null;
  /** What changed in the current version of the short summary (null for the evening build). */
  weekly_changed?: string | null;
  /** The newest version of this day's short summary I heard to the end; null when none. */
  my_weekly_heard_version?: number | null;
};
/** True when the listen chip has something to say (a summary exists for at least one kind). */
export const listenChipShown = (s: ListenStatusRow | null | undefined, nowMs: number = Date.now()): boolean => {
  const g = gateFromStatus(s, nowMs);
  return !(g.weekly === 'none' && g.context === 'none');
};
export const gateFromStatus = (s: ListenStatusRow | null | undefined, nowMs: number = Date.now(), local?: LocalListens | null): ListenGate => {
  const one = (which: Which): GateState => {
    if (!s) return 'none';
    const has = which === 'weekly' ? s.has_weekly : s.has_context;
    const g = which === 'weekly' ? s.weekly_generated_at : s.context_generated_at;
    if (!has || !g) return 'none';
    const built = new Date(g).getTime();
    const ok = (atIso: string): boolean => {
      const t = new Date(atIso).getTime();
      return isFinite(t) && t >= built;
    };
    // The server before this rule had no heard columns: fall back to the last play, as before.
    const heardKnown = which === 'weekly' ? s.my_weekly_heard : s.my_context_heard;
    const heardAt = which === 'weekly' ? (s.my_weekly_heard_at ?? null) : (s.my_context_heard_at ?? null);
    const mine = heardKnown == null ? (which === 'weekly' ? s.my_last_weekly_at : s.my_last_context_at) : heardKnown ? (heardAt ?? (which === 'weekly' ? s.my_last_weekly_at : s.my_last_context_at)) : null;
    if (mine && ok(mine)) return 'done';
    const l = local?.[which];
    if (l && l.heard && l.heardAt && l.generatedAt === g && ok(l.heardAt)) return 'done';
    return 'due';
  };
  return { weekly: one('weekly'), context: one('context') };
};
/** My Crew chip text and tone from the status and the phone's record: HEARD 100 / 60 PERCENT · FINISH / NOT HEARD. */
export const statusPercent = (s: ListenStatusRow | null | undefined, which: Which, local?: LocalListens | null): number => {
  const server = which === 'weekly' ? Number(s?.my_weekly_percent ?? 0) : Number(s?.my_context_percent ?? 0);
  const g = which === 'weekly' ? s?.weekly_generated_at : s?.context_generated_at;
  const l = local?.[which];
  const mine = l && g && l.generatedAt === g ? l.percent : 0;
  return Math.max(server || 0, mine);
};
export const listenChipText = (gate: ListenGate, percents: Record<Which, number>, compact = false): { text: string; tone: 'red' | 'amber' | 'green' } => {
  const due = gateDue(gate);
  if (!due) return { text: 'HEARD 100', tone: 'green' };
  const dueKinds = (['weekly', 'context'] as Which[]).filter((w) => gate[w] === 'due');
  const least = Math.min(...dueKinds.map((w) => percents[w] ?? 0));
  if (least > 0) return { text: `${Math.round(least)} PERCENT · FINISH`, tone: 'amber' };
  return { text: compact ? LISTEN_CHIP_DUE_SHORT : LISTEN_CHIP_DUE, tone: 'red' };
};
/** One line of the My Crew "Who listened" block, from get_crew_listen_progress rows (best per person per kind). */
export type CrewListenRow = { client_id: string; which: Which; by: string; by_name: string | null; role: string | null; percent: number; heard: boolean; at: string | null; version: number | null };
export type CrewListenLine = { by: string; name: string; weekly: number | null; context: number | null; weeklyHeard: boolean; contextHeard: boolean };
export const crewListenLines = (rows: CrewListenRow[], clientId: string, members: { id: string; name: string }[]): { crew: CrewListenLine[]; others: CrewListenLine[] } => {
  const byId = new Map<string, CrewListenLine>();
  const line = (id: string, name: string): CrewListenLine => byId.get(id) ?? (byId.set(id, { by: id, name, weekly: null, context: null, weeklyHeard: false, contextHeard: false }), byId.get(id)!);
  for (const m of members) line(m.id, m.name);
  for (const r of rows) {
    if (r.client_id !== clientId) continue;
    const l = line(r.by, r.by_name ?? 'Unknown');
    if (r.which === 'weekly') { l.weekly = Math.max(l.weekly ?? 0, r.percent); l.weeklyHeard = l.weeklyHeard || r.heard; }
    else { l.context = Math.max(l.context ?? 0, r.percent); l.contextHeard = l.contextHeard || r.heard; }
  }
  const memberIds = new Set(members.map((m) => m.id));
  const all = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { crew: all.filter((l) => memberIds.has(l.by)), others: all.filter((l) => !memberIds.has(l.by)) };
};
export const crewLineText = (l: CrewListenLine): string => {
  const one = (p: number | null, heard: boolean) => (p == null ? '0 percent' : heard ? '100 percent' : `${Math.round(p)} percent`);
  return `This week ${one(l.weekly, l.weeklyHeard)} · Health context ${one(l.context, l.contextHeard)}`;
};

/* ---------- The Add Workout listen sheet (22 Oct 2026) ----------
   Owner: "after both listens the trainer must tap Proceed to workout". Play records the listen on the server at
   once, so the refreshed row reads "done" seconds into the audio. Before this fix the second Play therefore made
   the form decide nothing was due, close the sheet (which stopped the voice) and open the workout form, and the
   button counted an item as heard the moment Play was tapped. Two rules close it:
   1. listenSheetUp: once the sheet has been needed it stays up until the trainer taps Proceed (armed), whatever
      the row says after a refresh.
   2. listenStillNeeded / listenAllHeard: what is due is judged from the row AS IT WAS WHEN THE SHEET OPENED
      (atOpen), and an item counts only when its audio played to the end on this phone (or its transcript stood in
      because nothing could speak). */
export type HeardMap = Record<Which, boolean>;
export const LISTEN_PROCEED = 'Proceed to workout';
export const LISTEN_WAIT = 'Listen first';

export const listenSheetUp = (o: { done: boolean; armed: boolean; eligible: boolean; due: boolean }): boolean =>
  !o.done && (o.armed || (o.eligible && o.due));

export const listenStillNeeded = (atOpen: ListenGate, heard: HeardMap, which: Which): boolean =>
  atOpen[which] === 'due' && !heard[which];

export const listenAllHeard = (atOpen: ListenGate, heard: HeardMap): boolean =>
  !listenStillNeeded(atOpen, heard, 'weekly') && !listenStillNeeded(atOpen, heard, 'context');

/* ---------- Speech chunking ----------
   Android TTS refuses one utterance longer than Speech.maxSpeechInputLength
   (about 4000 characters). Split a long script at sentence ends and queue the
   pieces; a single over-long sentence is cut at the limit. */
export const splitForSpeech = (script: string, max: number): string[] => {
  const text = (script ?? '').trim();
  if (!text) return [];
  if (!(max > 0) || text.length <= max) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > max && cur.trim()) { out.push(cur.trim()); cur = s; } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.flatMap((p) => (p.length <= max ? [p] : p.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) ?? [p]));
};
```

## tests/rules/health_summary_rules_test.js (full file)
```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/health_summary_rules_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/clientHealthSummary.ts (pure rules: gate, new-since, duration, split).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/clientHealthSummary.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, require);
const R = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const ME = 'me', OTHER = 'other';
const row = (over = {}) => ({
  client_id: 'c',
  weekly_summary: { script: 'Over the last seven days the client did three sessions. Sleep averaged seven hours.', highlights: ['3 sessions'] },
  weekly_generated_at: '2026-10-08T18:29:00Z', // 11:59 PM IST on 8 Oct
  context_summary: { script: 'Blood pressure improved. For anything clinical, please check the doctor consultation notes.', improved: [{}], worsened: [], watch: [{}, {}] },
  context_generated_at: '2026-10-05T04:00:00Z',
  context_dirty: false,
  listen_history: [],
  ...over,
});
const NOW = new Date('2026-10-09T05:00:00Z').getTime(); // 10:30 AM IST, 9 Oct
// gate: never listened
eq('never listened -> both due', R.listenGate(row(), ME, NOW), { weekly: 'due', context: 'due' });
// weekly heard today after the build, context heard after its build
const okHist = [{ at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly' }, { at: '2026-10-06T02:00:00Z', by: ME, which: 'context' }];
eq('heard today + context up to date -> done', R.listenGate(row({ listen_history: okHist }), ME, NOW), { weekly: 'done', context: 'done' });
eq('gateDue false when done', R.gateDue({ weekly: 'done', context: 'done' }), false);
// weekly heard yesterday (before the nightly build) -> due
eq('weekly heard before nightly build -> due', R.gateStateFor(row({ listen_history: [{ at: '2026-10-08T10:00:00Z', by: ME, which: 'weekly' }] }), 'weekly', ME, NOW), 'due');
// 18 Nov 2026: the short summary is heard once per version. A listen after the build counts on a later day too
// (the evening before, from My Crew's Tomorrow's Plan); until then it had to be on the same IST day.
eq('weekly heard after the build, the evening before -> done', R.gateStateFor(row({ listen_history: [{ at: '2026-10-08T18:29:30Z', by: ME, which: 'weekly' }] }), 'weekly', ME, NOW), 'done');
// context heard before its rebuild -> due; another person's listen never counts
eq('context heard before rebuild -> due', R.gateStateFor(row({ listen_history: [{ at: '2026-10-04T10:00:00Z', by: ME, which: 'context' }] }), 'context', ME, NOW), 'due');
eq('someone else heard -> still due for me', R.gateStateFor(row({ listen_history: [{ at: '2026-10-09T02:00:00Z', by: OTHER, which: 'weekly' }] }), 'weekly', ME, NOW), 'due');
// nothing to hear
// 24 Oct 2026: the server carries a context listen from an earlier day (carried: true) and the
// nightly build keeps the context's generated_at until a real update.
const carried = { at: '2026-10-06T02:00:00Z', by: ME, which: 'context', carried: true, briefing_date: '2026-10-06' };
eq('carried context listen after the build -> done', R.gateStateFor(row({ listen_history: [carried] }), 'context', ME, NOW), 'done');
eq('carried listen never satisfies the weekly', R.gateStateFor(row({ listen_history: [carried] }), 'weekly', ME, NOW), 'due');
eq('context rebuilt after the carried listen -> due', R.gateStateFor(row({ listen_history: [carried], context_generated_at: '2026-10-08T10:00:00Z' }), 'context', ME, NOW), 'due');
// 27 Oct 2026: the rule written once, shown everywhere
eq('rule line context due', R.listenRuleLine('context', 'due', 'Aarav Mehra'), 'Listen to this at least once. It changed since you last heard it. You cannot log a workout for Aarav until you do.');
eq('rule line weekly due', R.listenRuleLine('weekly', 'due', null), "Listen to this once after its latest update. You cannot log this client's workout until you do.");
eq('rule line done / none', [R.listenRuleLine('weekly', 'done', 'A'), R.listenRuleLine('context', 'none', 'A')], ['Heard after the latest update. You can log.', null]);
eq('header text', [R.listenHeaderText({ weekly: 'due', context: 'done' }), R.listenHeaderText({ weekly: 'done', context: 'none' })], ['NOT HEARD · LISTEN NOW', 'CLIENT SUMMARIES']);
eq('listen now line', R.listenNowLine('Aarav Mehra'), "You have not heard Aarav's summaries. You cannot log tomorrow's session without this. Listen now.");
const st = { client_id: 'c', has_weekly: true, has_context: true, weekly_generated_at: '2026-10-08T18:29:00Z', context_generated_at: '2026-10-05T04:00:00Z', my_last_weekly_at: '2026-10-09T02:00:00Z', my_last_context_at: '2026-10-06T02:00:00Z' };
eq('gate from status: both done', R.gateFromStatus(st, NOW), { weekly: 'done', context: 'done' });
eq('gate from status: weekly heard the evening before (after the build) -> done, context never -> due', R.gateFromStatus({ ...st, my_last_weekly_at: '2026-10-08T18:29:30Z', my_last_context_at: null }, NOW), { weekly: 'done', context: 'due' });
eq('gate from status: weekly heard before the build -> due', R.gateFromStatus({ ...st, my_last_weekly_at: '2026-10-08T10:00:00Z' }, NOW).weekly, 'due');
eq('gate from status: nothing built -> none', R.gateFromStatus({ ...st, has_weekly: false, has_context: false }, NOW), { weekly: 'none', context: 'none' });
eq('gate from status: missing row -> none', R.gateFromStatus(null, NOW), { weekly: 'none', context: 'none' });
eq('no weekly script -> none', R.gateStateFor(row({ weekly_summary: null, weekly_generated_at: null }), 'weekly', ME, NOW), 'none');
eq('empty script -> none', R.gateStateFor(row({ context_summary: { script: '  ' } }), 'context', ME, NOW), 'none');
eq('no row -> none/none', R.listenGate(null, ME, NOW), { weekly: 'none', context: 'none' });
eq('gateDue with one due', R.gateDue({ weekly: 'none', context: 'due' }), true);
// generated_at falls back to the json
eq('generatedAt falls back to json', R.generatedAtOf(row({ weekly_generated_at: null, weekly_summary: { script: 'x', generated_at: '2026-10-01T00:00:00Z' } }), 'weekly'), '2026-10-01T00:00:00Z');
// new since you listened
eq('isNewSince never listened', R.isNewSince(row(), 'weekly', ME), true);
eq('isNewSince heard after build', R.isNewSince(row({ listen_history: okHist }), 'weekly', ME), false);
eq('isNewSince no uid', R.isNewSince(row({ listen_history: okHist }), 'weekly', null), true);
// last listens
eq('lastListen newest of kind', R.lastListen([{ at: '1', by: 'a', which: 'weekly' }, { at: '2', by: 'b', which: 'context' }, { at: '3', by: 'c', which: 'weekly' }], 'weekly').by, 'c');
eq('myLastListen mine only', R.myLastListen([{ at: '1', by: ME, which: 'weekly' }, { at: '3', by: OTHER, which: 'weekly' }], 'weekly', ME).at, '1');
// duration + words
eq('durationText 67 words', R.durationText(Array(67).fill('w').join(' ')), '28 sec');
eq('durationText 283 words', R.durationText(Array(283).fill('w').join(' ')), '1 min 58 sec');
eq('scriptWords empty', R.scriptWords('  '), 0);
// IST day + stamp
eq('istDayOf 18:29Z is 8 Oct IST', R.istDayOf('2026-10-08T18:29:00Z'), '2026-10-08');
eq('istDayOf 18:31Z is 9 Oct IST', R.istDayOf('2026-10-08T18:31:00Z'), '2026-10-09');
eq('fmtStamp', R.fmtStamp('2026-10-09T09:46:14Z'), '9 Oct, 3:16 pm');
eq('fmtStamp empty', R.fmtStamp(null), '');
// split for speech
const long = Array(12).fill('This is a sentence that is fairly long and ends properly.').join(' ');
const parts = R.splitForSpeech(long, 200);
eq('split: every part within max', parts.every((p) => p.length <= 200), true);
eq('split: joins back to the text', parts.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '));
eq('split: short text untouched', R.splitForSpeech('Hello there.', 200), ['Hello there.']);
eq('split: empty', R.splitForSpeech('   ', 200), []);
eq('split: one over-long sentence is cut', R.splitForSpeech('a'.repeat(450), 200).map((p) => p.length), [200, 200, 50]);

// The Add Workout listen sheet (22 Oct 2026): the second Play no longer closes the sheet, only a play to the end counts.
const both = { weekly: 'due', context: 'due' };
const none = { weekly: false, context: false };
eq('sheet: due, not armed yet', R.listenSheetUp({ done: false, armed: false, eligible: true, due: true }), true);
eq('sheet: the refreshed row reads done after Play, but armed keeps it up', R.listenSheetUp({ done: false, armed: true, eligible: true, due: false }), true);
eq('sheet: armed stays up through a network blip', R.listenSheetUp({ done: false, armed: true, eligible: false, due: false }), true);
eq('sheet: Proceed tapped closes it', R.listenSheetUp({ done: true, armed: true, eligible: true, due: true }), false);
eq('sheet: nothing due, never armed', R.listenSheetUp({ done: false, armed: false, eligible: true, due: false }), false);
eq('sheet: not eligible (editing a queued log, offline at open)', R.listenSheetUp({ done: false, armed: false, eligible: false, due: true }), false);
eq('heard: nothing heard, both due', R.listenAllHeard(both, none), false);
eq('heard: first heard to the end only', R.listenAllHeard(both, { weekly: true, context: false }), false);
eq('heard: Play tapped on the second (row now says done) is not enough: atOpen still says due', R.listenStillNeeded(both, { weekly: true, context: false }, 'context'), true);
eq('heard: both heard to the end', R.listenAllHeard(both, { weekly: true, context: true }), true);
eq('heard: only the weekly was due at open', R.listenAllHeard({ weekly: 'due', context: 'done' }, { weekly: true, context: false }), true);
eq('heard: a missing summary is never required', R.listenAllHeard({ weekly: 'none', context: 'due' }, { weekly: false, context: true }), true);
eq('button copy', [R.LISTEN_PROCEED, R.LISTEN_WAIT], ['Proceed to workout', 'Listen first']);
// Tomorrow's Plan row chips (30 Oct 2026): the chip shows when any summary exists; the short label for crowded rows
eq('listen chip shown: both built', R.listenChipShown(st, NOW), true);
eq('listen chip hidden: nothing built', R.listenChipShown({ ...st, has_weekly: false, has_context: false }, NOW), false);
eq('listen chip shown: only the context built', R.listenChipShown({ ...st, has_weekly: false }, NOW), true);
eq('short label', R.LISTEN_CHIP_DUE_SHORT, 'NOT HEARD');

/* ---- listen progress (3 Nov 2026): heard only from 95 percent; legacy plays count; offline record merges ---- */
eq('legacy entry (no percent) is heard at 100', [R.entryHeard({ at: 'x', by: ME, which: 'weekly' }), R.entryPercent({ at: 'x', by: ME, which: 'weekly' })], [true, 100]);
eq('94 is not heard, 95 is', [R.entryHeard({ at: 'x', by: ME, which: 'weekly', percent: 94 }), R.entryHeard({ at: 'x', by: ME, which: 'weekly', percent: 95 })], [false, true]);
const playedToday = [{ at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly', percent: 40, heard: false }, { at: '2026-10-06T02:00:00Z', by: ME, which: 'context', percent: 30, heard: false }];
eq('a Play stopped at 40 and 30 percent leaves both due', R.listenGate(row({ listen_history: playedToday }), ME, NOW), { weekly: 'due', context: 'due' });
const heardToday = [{ at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly', percent: 97, heard: true, heard_at: '2026-10-09T02:05:00Z' }, { at: '2026-10-06T02:00:00Z', by: ME, which: 'context', percent: 100, heard: true }];
eq('97 percent today and 100 percent context are done', R.listenGate(row({ listen_history: heardToday }), ME, NOW), { weekly: 'done', context: 'done' });
eq('my progress: best percent of the current build', R.myProgress(row({ listen_history: [{ at: '2026-10-09T01:00:00Z', by: ME, which: 'weekly', percent: 20 }, { at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly', percent: 60 }, { at: '2026-10-07T02:00:00Z', by: ME, which: 'weekly', percent: 100 }] }), 'weekly', ME), 60);
eq('my progress: someone else does not count', R.myProgress(row({ listen_history: [{ at: '2026-10-09T02:00:00Z', by: OTHER, which: 'weekly', percent: 100 }] }), 'weekly', ME), 0);
const localHeard = { clientId: 'c', which: 'weekly', version: null, generatedAt: '2026-10-08T18:29:00Z', briefingDate: null, percent: 96, heard: true, heardAt: '2026-10-09T03:00:00Z', at: '2026-10-09T02:50:00Z', synced: false };
eq('offline record heard today clears the weekly gate', R.listenGate(row(), ME, NOW, { weekly: localHeard }).weekly, 'done');
eq('offline record for another build does not', R.listenGate(row(), ME, NOW, { weekly: { ...localHeard, generatedAt: '2026-10-07T18:29:00Z' } }).weekly, 'due');
eq('offline record at 50 does not', R.listenGate(row(), ME, NOW, { weekly: { ...localHeard, percent: 50, heard: false, heardAt: null } }).weekly, 'due');
eq('merged progress takes the higher of server and phone', R.mergedProgress(row({ listen_history: [{ at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly', percent: 40 }] }), 'weekly', ME, { ...localHeard, percent: 70, heard: false }), 70);
eq('progress lines', [R.progressLine(60), R.progressLine(95), R.progressLine(100)], ['You: 60 percent heard', 'Heard 100 percent, you can log.', 'Heard 100 percent, you can log.']);
eq('alert sentence', R.LISTEN_100_ALERT, 'Listen to 100 percent now, so you do not have to listen again when you log the session.');
// the batched status with the new columns
const stNew = { ...st, my_last_weekly_at: '2026-10-09T02:00:00Z', my_weekly_percent: 40, my_weekly_heard: false, my_weekly_heard_at: null, my_context_percent: 100, my_context_heard: true, my_context_heard_at: '2026-10-06T02:00:00Z', my_last_context_at: '2026-10-06T02:00:00Z' };
eq('status: a 40 percent play today is due, the heard context is done', R.gateFromStatus(stNew, NOW), { weekly: 'due', context: 'done' });
eq('status: old server without heard columns falls back to the last play', R.gateFromStatus({ ...st, my_last_weekly_at: '2026-10-09T02:00:00Z', my_last_context_at: '2026-10-06T02:00:00Z' }, NOW), { weekly: 'done', context: 'done' });
eq('status: the phone record clears it', R.gateFromStatus(stNew, NOW, { weekly: localHeard }).weekly, 'done');
eq('chip: 40 percent due reads FINISH', R.listenChipText({ weekly: 'due', context: 'done' }, { weekly: 40, context: 100 }), { text: '40 PERCENT · FINISH', tone: 'amber' });
eq('chip: nothing played reads NOT HEARD', R.listenChipText({ weekly: 'due', context: 'due' }, { weekly: 0, context: 0 }, true), { text: 'NOT HEARD', tone: 'red' });
eq('chip: all heard', R.listenChipText({ weekly: 'done', context: 'done' }, { weekly: 100, context: 100 }), { text: 'HEARD 100', tone: 'green' });
eq('status percent merges the phone record', R.statusPercent(stNew, 'weekly', { weekly: { ...localHeard, percent: 80, heard: false } }), 80);
// the crew block
const crewRows = [
  { client_id: 'c', which: 'weekly', by: 'm1', by_name: 'Sagar Sharma', role: 'trainer', percent: 100, heard: true, at: null, version: 5 },
  { client_id: 'c', which: 'context', by: 'm1', by_name: 'Sagar Sharma', role: 'trainer', percent: 40, heard: false, at: null, version: 2 },
  { client_id: 'c', which: 'weekly', by: 'x9', by_name: 'Dr Who', role: 'doctor', percent: 97, heard: true, at: null, version: 5 },
  { client_id: 'other', which: 'weekly', by: 'm2', by_name: 'Priya', role: 'trainer', percent: 100, heard: true, at: null, version: 5 },
];
const lines = R.crewListenLines(crewRows, 'c', [{ id: 'm1', name: 'Sagar Sharma' }, { id: 'm2', name: 'Priya Singh' }]);
eq('crew lines: every member listed, others separate', [lines.crew.map((l) => l.name), lines.others.map((l) => l.name)], [['Priya Singh', 'Sagar Sharma'], ['Dr Who']]);
eq('crew line text: Sagar', R.crewLineText(lines.crew[1]), 'This week 100 percent · Health context 40 percent');
eq('crew line text: Priya never played this client', R.crewLineText(lines.crew[0]), 'This week 0 percent · Health context 0 percent');
eq('crew line text: 97 reads as 100 (heard)', R.crewLineText(lines.others[0]), 'This week 100 percent · Health context 0 percent');

/* ---------- 18 Nov 2026: the short summary every evening, new details, the roster popup ---------- */
{
  // built 5:00 PM IST on 8 Oct for the session of 9 Oct; heard at 6 PM the same evening; logged next morning
  const evening = row({ weekly_generated_at: '2026-10-08T11:30:00Z', briefing_date: '2026-10-09', listen_history: [{ at: '2026-10-08T12:30:00Z', by: ME, which: 'weekly', version: 2, percent: 100, heard: true, heard_at: '2026-10-08T12:32:00Z', briefing_date: '2026-10-09' }] });
  eq('evening listen counts on the session day', R.gateStateFor(evening, 'weekly', ME, NOW), 'done');
  // new details at 8 PM: version 3; the evening listen is of the older version
  const rebuilt = { ...evening, weekly_generated_at: '2026-10-08T14:30:00Z' };
  eq('a newer version after the listen -> due again', R.gateStateFor(rebuilt, 'weekly', ME, NOW), 'due');
  eq('and its percent starts from 0', R.myProgress(rebuilt, 'weekly', ME), 0);
  eq('a part listen of the new version shows its own percent', R.myProgress({ ...rebuilt, listen_history: [...evening.listen_history, { at: '2026-10-08T15:00:00Z', by: ME, which: 'weekly', version: 3, percent: 40, heard: false }] }, 'weekly', ME), 40);
  eq('60 percent of the current version is not heard', R.gateStateFor({ ...evening, listen_history: [{ at: '2026-10-08T12:30:00Z', by: ME, which: 'weekly', version: 2, percent: 60, heard: false }] }, 'weekly', ME, NOW), 'due');

  // the wrong green line (found live 18 Nov 2026): the long summary rebuilt on 15 Nov, the only listen is the one
  // of 1 Nov that the server carries forward. The bar said 100 percent, the rule line said listen again.
  const ctx = row({ context_generated_at: '2026-11-15T00:57:00Z', listen_history: [{ at: '2026-11-01T16:52:00Z', by: ME, which: 'context', version: 1, carried: true, briefing_date: '2026-11-01' }] });
  const NOV18 = new Date('2026-11-18T05:40:00Z').getTime();
  eq('carried listen of an older version: the gate says due', R.gateStateFor(ctx, 'context', ME, NOV18), 'due');
  eq('carried listen of an older version: the percent is 0, not 100', [R.myProgress(ctx, 'context', ME), R.mergedProgress(ctx, 'context', ME, null)], [0, 0]);
  eq('so the line under the bar no longer says you can log', R.progressLine(R.mergedProgress(ctx, 'context', ME, null)), 'You: 0 percent heard');
  // a listen carried from an earlier day of the SAME version still counts (heard once per update)
  const same = row({ context_generated_at: '2026-11-15T00:57:00Z', listen_history: [{ at: '2026-11-15T04:00:00Z', by: ME, which: 'context', version: 3, carried: true, percent: 100, heard: true, heard_at: '2026-11-15T04:02:00Z', briefing_date: '2026-11-15' }] });
  eq('carried listen of the same version: done and 100', [R.gateStateFor(same, 'context', ME, NOV18), R.myProgress(same, 'context', ME)], ['done', 100]);
  eq('legacy carried play after the build counts as 100', R.myProgress(row({ context_generated_at: '2026-11-15T00:57:00Z', listen_history: [{ at: '2026-11-16T04:00:00Z', by: ME, which: 'context', carried: true }] }), 'context', ME), 100);

  // the roster popup
  const s0 = { client_id: 'c', has_weekly: true, has_context: true, weekly_generated_at: '2026-10-08T11:30:00Z', context_generated_at: '2026-10-05T04:00:00Z', my_last_weekly_at: null, my_last_context_at: null,
    weekly_version: 3, my_weekly_heard: false, my_weekly_percent: 0, my_context_heard: true, my_context_heard_at: '2026-10-06T02:00:00Z', briefing_date: '2026-10-09', weekly_rebuilding: false, weekly_rebuild_reason: null, weekly_changed: null, my_weekly_heard_version: null };
  const kind = (s) => R.rosterPopupKind(s, R.gateFromStatus(s, NOW));
  eq('popup: never heard', kind(s0), 'unheard');
  eq('popup: heard version 2, version 3 is out', kind({ ...s0, my_weekly_heard_version: 2 }), 'new_version');
  const heard3 = { ...s0, my_weekly_heard: true, my_weekly_heard_at: '2026-10-08T12:32:00Z', my_weekly_percent: 100, my_weekly_heard_version: 3 };
  eq('popup: heard the current version -> none', kind(heard3), 'none');
  eq('popup: heard the current one, a newer one is being made', kind({ ...heard3, weekly_rebuilding: true, weekly_rebuild_reason: 'a session was completed' }), 'new_version');
  eq('popup: never heard and one is being made', kind({ ...s0, weekly_rebuilding: true }), 'unheard');
  eq('popup: no short summary at all -> none', [kind({ ...s0, has_weekly: false, weekly_generated_at: null }), kind(null)], ['none', 'none']);
  eq('popup: only the long summary is due -> none (the chip and the log sheet cover it)', kind({ ...heard3, my_context_heard: false, my_context_heard_at: null }), 'none');
  eq('popup: the phone heard it offline -> none', R.rosterPopupKind(s0, R.gateFromStatus(s0, NOW, { weekly: { clientId: 'c', which: 'weekly', version: 3, generatedAt: s0.weekly_generated_at, briefingDate: '2026-10-09', percent: 100, heard: true, heardAt: '2026-10-08T12:40:00Z', at: '2026-10-08T12:38:00Z', synced: false } })), 'none');
  eq('popup key: one per client, day and version; a rebuild has its own', [R.rosterPopupKey(s0), R.rosterPopupKey({ ...s0, weekly_version: 4 }), R.rosterPopupKey({ ...s0, weekly_rebuilding: true }), R.rosterPopupKey(null)], ['c|2026-10-09|3', 'c|2026-10-09|4', 'c|2026-10-09|making', '']);

  eq('changed sentence', [R.changedSentence('a session was completed, a trainer added a note'), R.changedSentence('  nutrition, steps or water was entered. '), R.changedSentence(null), R.changedSentence('')], ['A session was completed, a trainer added a note.', 'Nutrition, steps or water was entered.', '', '']);
  eq('popup text: new version with what changed', R.rosterPopupText('new_version', { ...s0, weekly_changed: 'a session was completed' }, 'Asha Kapoor'), { title: 'New details for Asha', body: 'Since you listened: A session was completed. We made a new summary. Listen to it now.', making: false });
  eq('popup text: new version, the evening build (no reason)', R.rosterPopupText('new_version', s0, 'Asha').body, 'The summary was updated since you listened. We made a new summary. Listen to it now.');
  eq('popup text: being made, with the reason', R.rosterPopupText('new_version', { ...s0, weekly_rebuilding: true, weekly_rebuild_reason: 'a session was cancelled', weekly_changed: 'old reason' }, 'Asha'), { title: 'New details for Asha', body: 'Since you listened: A session was cancelled. We are making a new summary.', making: true });
  eq('popup text: being made, no reason', R.rosterPopupText('new_version', { ...s0, weekly_rebuilding: true }, 'Asha').body, 'New details came in since you listened. We are making a new summary.');
  eq('popup text: never heard, tomorrow and today', [R.rosterPopupText('unheard', s0, 'Asha').body, R.rosterPopupText('unheard', s0, null, 'today').body, R.rosterPopupText('unheard', s0, 'Asha').title], ["You have not heard Asha's summary for tomorrow yet. Listen to it now, so you do not have to when you log the session.", "You have not heard this client's summary for today yet. Listen to it now, so you do not have to when you log the session.", "Listen to Asha's summary"]);
  eq('popup text: none', R.rosterPopupText('none', s0, 'Asha'), { title: '', body: '', making: false });
  // which popup opens next in the plan sheet
  {
    const due = { ...s0, client_id: 'a' }, upd = { ...s0, client_id: 'b', my_weekly_heard_version: 2 }, ok = { ...heard3, client_id: 'd' };
    const statuses = { a: due, b: upd, d: ok };
    const kindOf = (cid) => R.rosterPopupKind(statuses[cid], R.gateFromStatus(statuses[cid], NOW));
    const next = (o) => R.nextRosterPopup({ added: [], selected: [], statuses, kindOf, lastShown: {}, ...o });
    eq('next popup: a client just added and never heard', next({ added: ['a'], selected: ['a'] }), { open: { clientId: 'a', kind: 'unheard' }, consumed: ['a'], shown: { a: 'a|2026-10-09|3' } });
    eq('next popup: added, already heard -> nothing, and done with', next({ added: ['d'], selected: ['d'] }), { open: null, consumed: ['d'], shown: {} });
    eq('next popup: added, its status not here yet -> waits', next({ added: ['z'], selected: ['z'] }), { open: null, consumed: [], shown: {} });
    eq('next popup: added then taken off the plan again -> nothing', next({ added: ['a'], selected: [] }).open, null);
    eq('next popup: a restored plan opens only for a newer version, never just for unheard', next({ selected: ['a', 'b', 'd'] }).open, { clientId: 'b', kind: 'new_version' });
    eq('next popup: eight restored unheard clients, no popup', next({ selected: ['a'] }).open, null);
    eq('next popup: the same version is not shown twice', next({ selected: ['b'], lastShown: { b: 'b|2026-10-09|3' } }).open, null);
    eq('next popup: a later version opens it again', R.nextRosterPopup({ added: [], selected: ['b'], statuses: { b: { ...upd, weekly_version: 4 } }, kindOf: () => 'new_version', lastShown: { b: 'b|2026-10-09|3' } }).open, { clientId: 'b', kind: 'new_version' });
    const making = { ...heard3, client_id: 'm', weekly_rebuilding: true };
    eq('next popup: a rebuild starts while the plan is open', R.nextRosterPopup({ added: [], selected: ['m'], statuses: { m: making }, kindOf: () => 'new_version', lastShown: {} }), { open: { clientId: 'm', kind: 'new_version' }, consumed: [], shown: { m: 'm|2026-10-09|making' } });
    eq('next popup: minimized while it was being made, the finished one does not pop up by itself', R.nextRosterPopup({ added: [], selected: ['m'], statuses: { m: { ...making, weekly_rebuilding: false, weekly_version: 4, my_weekly_heard: false } }, kindOf: () => 'new_version', lastShown: { m: 'm|2026-10-09|making' } }), { open: null, consumed: [], shown: { m: 'm|2026-10-09|4' } });
    eq('next popup: one at a time, the added client first', next({ added: ['a'], selected: ['a', 'b'] }).open, { clientId: 'a', kind: 'unheard' });
    eq('next popup: then the other one', next({ added: [], selected: ['a', 'b'], lastShown: { a: 'a|2026-10-09|3' } }).open, { clientId: 'b', kind: 'new_version' });
  }
  eq('popup words', [R.ROSTER_POPUP_MINIMIZE, /minimize this and carry on/.test(R.ROSTER_POPUP_MAKING)], ['Minimize', true]);
  const dash = String.fromCharCode(0x2014);
  eq('no long dash in the popup copy', [R.ROSTER_POPUP_MAKING, R.rosterPopupText('new_version', s0, 'A').body, R.rosterPopupText('unheard', s0, 'A').body].some((x) => x.includes(dash)), false);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
```
