# iOS handoff: Essentials cancellations, both paths, end to end (27 Oct 2026)

For the iOS Expo repo. Two paths, exactly as the Android app does them:
- **A. The client cancels in the client (B2C) app**: the trainer is told and, for today's or tomorrow's training, marks it.
- **B. A paid cancellation marked by the trainer** on the roster (the 22 Oct session code flow), for any client.

Server side is live (hub-track migrations `20261026100000`, `20261027100000`, `20261027110000`; nothing to port).
Android commits: 5ed82d9 (26 Oct), 89c59d9 (27 Oct). Feature doc:
`b2b/docs/features/android/trainer/essentials-auction.md` section 6 ("A cancelled day leaves the auction" and
"The client app's own cancel rule"). Copy rule: no dashes in user-facing text; "client", "session", times as 7:00 PM.

---

## A. The client cancels in the client app

### A1. The rule (owner, 26 and 27 Oct 2026)
- Only the client cancels an Essentials training, from the client app (`essentials_cancel_training` for a booked
  session, `essentials_cancel_plan_day` for a planned day). Nobody on the staff side cancels a session booked through
  the auction (roster notes start "Essentials by Odds"): the roster update is refused with `ESSENTIALS_LOCKED`.
- Measured against the start time, India time: **more than 6 hours before = free** (not one of the 20);
  **6 hours or less = paid** (one of the 20); after the start = refused.
- **Today or tomorrow = tagged, not removed.** The roster row stays `scheduled` with `canceled_by = 'Client'` and a
  remark starting "Cancelled by the client in the app …" that says "paid cancellation" or "free cancellation" and
  "Please mark it."; the planned day keeps its place with `cancel {kind, at, hours_before, schedule_id}`.
  The trainer marks it from the home alert.
- **Two or more days ahead = normal.** The client app cancels the roster row itself and removes the day. Nothing to mark.
- Before any booking: a tagged day leaves the auction at once; a bid answers "The client cancelled this session.".

### A2. Server contracts (live)
| Call | Shape | Notes |
|---|---|---|
| `get_my_essentials_cancellations(p_hours int default 48)` | rows `{round_key, client_id, client_name, training_date, slot_time "19:00", modality, cancelled_at, session_id, was_winner, tagged boolean, kind 'paid' \| 'free', hours_before numeric \| null, schedule_status text \| null, marked boolean}` | the signed-in trainer's sessions the client cancelled (winner of the round or the roster row's trainer), newest first; `PGRST202` means "no alert" |
| `essentials_mark_client_cancellation(p_schedule_id uuid)` | `{ok, paid, training_session_id, location}` or `{ok, already: true, paid}` | the row's trainer or the care team; the row must carry `canceled_by = 'Client'` and the client app's remark; turns the row cancelled; paid → `paid_cancellation`, `admin_approval pending` and a cancelled `training_sessions` row with `paid_cancellation = true` (one of the 20); free → no row. Errors are plain sentences ("Only the trainer of this session or the care team can mark it.", "This session was not cancelled by the client in the app."). |
| `get_my_auction_results` | `result = 'cancelled'`, `won = false` on a cancelled round | the results card text |
| `session_schedule` update to `status = 'cancelled'` on a row whose notes start "Essentials by Odds" | refused: message starts `ESSENTIALS_LOCKED:` | map to the friendly copy |
| Push (edge `notify-essentials-unsold`, generic staff push, sent by the SQL trigger) | title `Essentials session cancelled`; body = the client app's words for a tagged day ("Aarav cancelled tomorrow's 7:00 pm Strength in the app, 4.2 hours before: a paid cancellation, one of their 20. Mark it on your roster.") or "… in the app. It is off your roster."; `data = {type: 'essentials_cancelled', route: 'home', client_id, date, session_id, kind, tagged}` | tap → home |
| Today's Roster row | `canceled_by`, `cancellation_remark`, `status` | the tag is `canceled_by = 'Client'` AND remark starts "Cancelled by the client in the app" AND status not cancelled; paid when the remark says "paid cancellation" and not "free cancellation" |

### A3. `src/lib/essentialsAuction.ts` (add; `addDays`, `formatLotDate`, `formatTime12`, `istParts` already exist there)
```ts
export type RoundResult = 'won' | 'booked_elsewhere' | 'no_bids' | 'no_winner' | 'cancelled' | null;

export const ESSENTIALS_LOCKED_PREFIX = 'ESSENTIALS_LOCKED';
export const ESSENTIALS_LOCKED_MESSAGE = 'This Essentials session was booked through the auction. Only the client can cancel it, in the Essentials app.';
export const isEssentialsLockedError = (message: string | null | undefined): boolean => (message ?? '').includes(ESSENTIALS_LOCKED_PREFIX);

export type EssentialsCancellation = {
  round_key: string; client_id: string; client_name: string; training_date: string; slot_time: string; modality: string;
  cancelled_at: string; session_id: string | null; was_winner: boolean;
  tagged: boolean; kind: 'paid' | 'free'; hours_before: number | null; schedule_status: string | null; marked: boolean;
};

export const cancellationLine = (c: Pick<EssentialsCancellation, 'client_name' | 'modality' | 'training_date' | 'slot_time'>): string =>
  `${c.client_name} cancelled ${c.modality || 'the training'} on ${formatLotDate(c.training_date)}${c.slot_time ? ` at ${formatTime12(c.slot_time)}` : ''}`;

export const clientCancelLine = (c: Pick<EssentialsCancellation, 'client_name' | 'modality' | 'training_date' | 'slot_time' | 'tagged' | 'kind' | 'hours_before'>, todayYmd: string): string => {
  const when = c.training_date === todayYmd ? "today's" : c.training_date === addDays(todayYmd, 1) ? "tomorrow's" : `${formatLotDate(c.training_date)}'s`;
  const what = `${when}${c.slot_time ? ` ${formatTime12(c.slot_time)}` : ''} ${c.modality || 'training'}`;
  if (!c.tagged) return `${c.client_name} cancelled ${what} in the app. It is off your roster.`;
  const hours = c.hours_before != null ? `, ${Math.round(c.hours_before * 10) / 10} hours before` : '';
  return `${c.client_name} cancelled ${what} in the app${hours}: ${c.kind === 'paid' ? 'a paid cancellation, one of their 20' : 'a free cancellation'}. Mark it on your roster.`;
};

export const markedLine = (kind: 'paid' | 'free'): string => (kind === 'paid' ? 'Marked as a paid cancellation. The care team approves the payout.' : 'Marked as a free cancellation. Nothing counts.');
```
In `resultHeadline`, before the last `return`: `if (r.result === 'cancelled') return `${r.client_name}'s ${r.modality} on ${when} was cancelled`;`

### A4. `src/lib/essentialsAuctionQueries.ts` (append; `RpcResult`, `withTimeout`, `NET_MS`, `describeGrabError` are the ones `useMyAuctionResults` uses)
```ts
export function useMyEssentialsCancellations(hours = 48, enabled = true) {
  return useQuery({
    queryKey: ['essentials-cancellations', hours], enabled, staleTime: 60_000, refetchInterval: enabled ? 5 * 60_000 : false, refetchOnWindowFocus: true,
    queryFn: async (): Promise<EssentialsCancellation[]> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('get_my_essentials_cancellations', { p_hours: hours })) as Promise<RpcResult>, NET_MS, 'Essentials cancellations');
      if (error) { if (error.code === 'PGRST202' || /PGRST202|could not find the function/i.test(String(error.message ?? ''))) return []; throw new Error(describeGrabError(error)); }
      return ((data ?? []) as any[]).map((r) => ({
        round_key: String(r.round_key ?? `${r.client_id}:${r.training_date}`), client_id: String(r.client_id), client_name: r.client_name ?? 'Client',
        training_date: String(r.training_date), slot_time: String(r.slot_time ?? '').slice(0, 5), modality: r.modality ?? '',
        cancelled_at: String(r.cancelled_at), session_id: r.session_id ?? null, was_winner: !!r.was_winner,
        tagged: r.tagged === true, kind: r.kind === 'paid' ? 'paid' : 'free', hours_before: r.hours_before == null ? null : Number(r.hours_before),
        schedule_status: r.schedule_status ?? null, marked: r.marked === true,
      }));
    },
  });
}

export function useMarkClientCancellation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scheduleId: string) => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('essentials_mark_client_cancellation', { p_schedule_id: scheduleId })) as Promise<RpcResult>, NET_MS, 'Mark cancellation');
      if (error) throw new Error(describeGrabError(error));
      return (data ?? {}) as { ok?: boolean; paid?: boolean; already?: boolean };
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['essentials-cancellations'] }); qc.invalidateQueries({ queryKey: ['trainer-roster'] }); },
  });
}
```

### A5. `src/components/essentialsCancelledAlert.tsx` (new, copy whole from the Android repo, 96 lines)
Rose card "ESSENTIALS · CANCELLED BY THE CLIENT", title "A client cancelled a session" / "N clients cancelled a
session"; one row per cancellation with `clientCancelLine(r, istParts().date)`; under it "Cancelled in the Essentials
app at 3:48 PM IST", or `markedLine(kind)` once marked. A **tagged, unmarked** row shows **Mark as cancelled on my
roster** (confirm alert: paid "… turns cancelled on your roster as a paid cancellation, one of their 20. The care team
approves the payout." / free "… as a free cancellation. Nothing counts."; then `useMarkClientCancellation`) and cannot
be dismissed. Every other row has **Got it** (dismissed keys in AsyncStorage `essentials-cancelled-dismissed:<uid>`,
pruned to the rounds still served). Reads the uid from `useAuth().session?.user?.id`.

### A6. Mounts and routes
- Trainer home: right after `<EssentialsUnsoldAlert />`; Doctor Dashboard: for physios next to the same.
- `PushTokenManager`: `if (t === 'essentials_cancelled') { go(homeRouteFor(roleRef.current)); return; }` before the fallback.
- `useCancelScheduledSession` (`trainerQueries.ts`): map the locked error after the paid-code gate:
  `isEssentialsLockedError(error.message) ? ESSENTIALS_LOCKED_MESSAGE : error.message`.

### A7. Today's Roster (`trainerQueries.ts` + the roster card)
- Select adds `canceled_by, cancellation_remark`. `RosterRow.client_cancel: 'paid' | 'free' | null`:
  ```ts
  client_cancel: s.canceled_by === 'Client' && /^cancelled by the client in the app/i.test(String(s.cancellation_remark ?? '')) && String(s.status ?? '').toLowerCase() !== 'cancelled'
    ? (/paid cancellation/i.test(String(s.cancellation_remark)) && !/free cancellation/i.test(String(s.cancellation_remark)) ? 'paid' : 'free') : null,
  ```
- The card's chip row, after the modality chip: a red chip "Cancelled by the client · paid, mark it" or "· free, mark it".

### A8. Tests (`tests/rules/auction_rules_test.js`, copy the Android checks)
headline cancelled, detail cancelled, cancellation line, locked error, client cancel line (tagged paid tomorrow,
tagged free today, normal), marked lines.

---

## B. A paid cancellation marked by the trainer (any client)

Already in the iOS repo from `ios-session-code-handoff.md` (22 Oct 2026, section 5 "Cancel a session" and
`PaidCancelCodeStep`). The rules, so both apps stay identical:
1. Today's Roster → Cancel → type picker; **Paid cancellation** ("Last-moment cancel, counted as paid after admin
   approval") double-confirms. The trainer writes the remark and picks Cancelled by: Client or Trainer.
2. **Code gate:** a trainer, physio or therapist cannot save a paid cancellation without the client's **paid
   cancellation code** from the CRM (4 digits, different from the session code): `PaidCancelCodeStep` shows the
   CRM's name and phone (`get_client_crm_contact`), verifies through `verify_paid_cancellation_code(p_schedule_id,
   p_code)`; the server trigger refuses a paid cancel without a verified code (`PAID_CANCEL_CODE_REQUIRED`, mapped to
   the friendly copy). CRM, admin and ops need no code.
3. On save (`useCancelScheduledSession`): `session_schedule` → `status cancelled`, `cancellation_remark`,
   `canceled_by`, and for paid `paid_cancellation = true`, `admin_approval = pending`; a best-effort push to the client's
   CRMs (`notify-session-cancelled`). The request lands in the admin's Requests → Paid Cancel queue; approved = the
   client is charged and the trainer is paid (Plutus reads the approval).
4. For an Essentials client it counts as one of the 20 only through the cancelled `training_sessions` row; parked or
   complimentary rows never count.
5. **Not for auction bookings:** a session whose roster notes start "Essentials by Odds" cannot be cancelled this way
   (ESSENTIALS_LOCKED, path A applies). The client's own tagged cancellation needs no code and no choice: the 6-hour
   rule decides paid or free.

Files (copy byte for byte from Android if not already identical): `src/components/cancelSessionFlow.tsx` (173 lines),
`src/components/PaidCancelCodeStep.tsx` (120), the `useCancelScheduledSession` contract in `src/lib/trainerQueries.ts`,
the paid-cancel rules in `src/lib/sessionOtp.ts` and `src/lib/sessionOtpQueries.ts` (22 Oct handoff).

---

## Verify on an iPhone
1. Client cancels **tomorrow's booked** training less than 6 hours before: push with the client app's words; home card
   with Mark as cancelled on my roster; roster chip "Cancelled by the client · paid, mark it"; after marking, the row is
   cancelled, the card reads "Marked as a paid cancellation…", the admin's Paid Cancel queue lists it.
2. Same, more than 6 hours before: "… a free cancellation. Mark it on your roster."; after marking, no training row,
   the card reads "Marked as a free cancellation. Nothing counts."
3. Client cancels a training **two or more days ahead**: "… It is off your roster." with Got it; the session is gone from
   the roster and the auction.
4. A trainer tries to cancel an auction-booked session from the roster: the locked message, the row stays.
5. A trainer marks a paid cancellation on a normal (non-auction) session: the code step, then the admin queue.
6. `node tests/rules/auction_rules_test.js`.
