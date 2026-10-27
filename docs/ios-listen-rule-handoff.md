# iOS handoff: the listen rule everywhere (27 Oct 2026)

For the iOS Expo repo. Android commit of 27 Oct 2026 (odds-app). Server: hub-track migration
`20261027120000_get_my_listen_status.sql` (run by the owner). Feature doc:
`b2b/docs/features/android/trainer/client-health-summary.md` section 3 ("The rule, written once"). Copy rule: no dashes.

## The rule (owner, 27 Oct 2026)
- Big summary (Health context): heard at least once after each update.
- Small summary (This week's training): heard at least once after each update (it is rebuilt nightly, so once a day).
- Until both are heard the trainer cannot log that client's workout; the rule is shown wherever the Play rows are.

## Pure rules: `src/lib/clientHealthSummary.ts` (add; `istDayOf`, `Which`, `GateState`, `ListenGate`, `gateDue` exist)
```ts
export const LISTEN_WHY = 'Each summary must be heard once after it changes, or Submit stays off.';
export const LISTEN_HEADER_DUE = 'NOT HEARD · LISTEN NOW';
export const LISTEN_HEADER_OK = 'CLIENT SUMMARIES';
export const listenHeaderText = (g: ListenGate): string => (gateDue(g) ? LISTEN_HEADER_DUE : LISTEN_HEADER_OK);
export const listenRuleLine = (which: Which, state: GateState, clientFirstName?: string | null): string | null => {
  const name = (clientFirstName ?? '').trim().split(/\s+/)[0] || 'this client';
  if (state === 'none') return null;
  if (state === 'done') return 'Heard after the latest update. You can log.';
  return which === 'context'
    ? `Listen to this at least once. It changed since you last heard it. You cannot log a workout for ${name} until you do.`
    : `Listen to this at least once today. You cannot log ${name}'s workout until you do.`;
};
export const LISTEN_CHIP_DUE = 'NOT HEARD · LISTEN NOW';
export const LISTEN_CHIP_OK = 'HEARD';
export const listenNowLine = (clientFirstName: string | null | undefined, when: 'tomorrow' | 'today' = 'tomorrow'): string =>
  `You have not heard ${(clientFirstName ?? '').trim().split(/\s+/)[0] || 'this client'}'s summaries. You cannot log ${when}'s session without this. Listen now.`;
export type ListenStatusRow = { client_id: string; has_weekly: boolean; has_context: boolean; weekly_generated_at: string | null; context_generated_at: string | null; my_last_weekly_at: string | null; my_last_context_at: string | null };
export const gateFromStatus = (s: ListenStatusRow | null | undefined, nowMs: number = Date.now()): ListenGate => {
  const one = (which: Which): GateState => {
    if (!s) return 'none';
    const has = which === 'weekly' ? s.has_weekly : s.has_context;
    const g = which === 'weekly' ? s.weekly_generated_at : s.context_generated_at;
    const mine = which === 'weekly' ? s.my_last_weekly_at : s.my_last_context_at;
    if (!has || !g) return 'none';
    if (!mine) return 'due';
    const heardAt = new Date(mine).getTime();
    if (!isFinite(heardAt) || heardAt < new Date(g).getTime()) return 'due';
    if (which === 'weekly' && istDayOf(mine) !== istDayOf(nowMs)) return 'due';
    return 'done';
  };
  return { weekly: one('weekly'), context: one('context') };
};
```
Tests: the 9 checks added to `tests/rules/health_summary_rules_test.js` on Android (copy them).

## Server contract (live after the migration)
`get_my_listen_status(p_client_ids uuid[])` → rows `{client_id, has_weekly, has_context, weekly_generated_at,
context_generated_at, my_last_weekly_at, my_last_context_at}` for the caller, one call per list; clients the caller
may not listen to are left out; `PGRST202` before the migration means "no chips".

## `src/lib/clientHealthSummaryQueries.ts` (append)
`useMyListenStatuses(clientIds, enabled)`: key `['listen-status', sortedIds.join(',')]`, 60 s stale, calls the RPC,
returns `Record<clientId, ListenStatusRow>`; PGRST202 → `{}`.

## `src/components/clientHealthSummaryCard.tsx`
1. `SummaryRow` takes `rule?: string | null; ruleDue?: boolean` and renders, above the "Last listened" line, a small box:
   red (`alert` icon, `#FF9B8F`) when due, green (`checks` icon) when heard, with the rule text in `F.bodySemi` 11.5.
2. `ClientSummaryStrip` gains `clientName?: string | null` and `defaultOpen?: boolean`; computes
   `gate = listenGate(row, uid)`, `due = gateDue(gate)`; while due the border is red (`hexA(C.red, 0.55)`), the icon is
   `alert`, the header reads "Not heard · listen now" in `#FF9B8F`; the open body starts with `LISTEN_WHY`; every row gets
   `rule={listenRuleLine(which, gate[which], clientName)} ruleDue={gate[which] === 'due'}`.
3. `ClientHealthSummaryCard` gains `clientName?`; the rows list starts with `LISTEN_WHY` and each row gets the same rule
   props from `listenGate(row, uid)`.
4. `ListenGateSheet`: the subtitle becomes `${LISTEN_WHY} This week's training changes every day; the health context
   changes when a new report arrives. Hear each one to the end, then tap Proceed to workout.`; each row gets
   `rule={listenRuleLine(which, gateNow[which], clientName)} ruleDue={gateNow[which] === 'due' && !heard[which]}`.
5. New exports (copy from Android): `ListenStatusChip({ status, onPress })` (red "NOT HEARD · LISTEN NOW" / green
   "HEARD", nothing when no summary exists) and `ListenNowSheet({ info: {id, name, when?} | null, onClose })` (bottom
   sheet "Listen now" with `listenNowLine` and `<ClientSummaryStrip clientId clientName defaultOpen />`).

## Screens
- Today's Roster strip: pass `clientName={row.client_name}`.
- Log Health Data popup (the first screen on the roster log path): before the shared coach notes block, a mono
  "BEFORE YOU LOG" label and `<ClientSummaryStrip clientId={selectedClientId} clientName={clientName} accent={C.gold} defaultOpen />`.
- My Crew, Tomorrow's Plan sheet: `useMyListenStatuses(rows.map(r => r.clientId), visible)`; on each row, after the
  voice chip, `<ListenStatusChip status={listenById[r.clientId]} onPress={() => setListenFor({ id: r.clientId, name: r.name })} />`;
  render `<ListenNowSheet info={listenFor} onClose={() => { setListenFor(null); listenQ.refetch(); }} />` next to the
  voice popup.

## Verify on an iPhone
A client whose summaries you have not heard: the roster strip is red with "Not heard · listen now" and the two red
lines; the Log Health Data popup opens with the BEFORE YOU LOG strip; hearing both turns the lines green ("Heard after
the latest update. You can log.") and the strip gold; the client page card shows the same; in My Crew the row's chip is
red, Listen now opens the sheet, hearing both and closing it turns the chip green.
`node tests/rules/health_summary_rules_test.js`.
