# iOS handoff: the client cancels an Essentials day, the session leaves the auction (26 Oct 2026)

For the iOS Expo repo. Server side done (hub-track migration `20261026100000_essentials_client_cancellations.sql`,
run by the owner). Feature doc: `b2b/docs/features/android/trainer/essentials-auction.md` section 6,
"A cancelled day leaves the auction". Copy rule: no dashes in user-facing text.

## The rule (owner decisions, 26 Oct 2026)
- Only the client cancels, as a rest day in the Essentials app (the date is dropped from `essentials_weeks.days`).
  The server then cancels any roster row booked for it (Cancelled by: Client), marks the auction round
  `result = 'cancelled'`, pushes the trainer and writes a care-team note.
- Nobody on the staff side cancels a session booked through the auction (roster notes start "Essentials by Odds"):
  the `session_schedule` update is refused with a message starting `ESSENTIALS_LOCKED`.
- Before the auction the card is simply not built; during it the card disappears and bids answer
  "The client cancelled this session."; after a sale the trainer gets the push and a dashboard alert.

## Server contracts
- `get_my_essentials_cancellations(p_hours int default 48)` → rows `{round_key, client_id, client_name, training_date,
  slot_time ("19:00"), modality, cancelled_at, session_id, was_winner}`: the caller's sessions the client cancelled
  (winner of the round, or the cancelled roster row's trainer), newest first.
- Push to the trainer: title "Essentials session cancelled", body "NAME cancelled Strength on 27 Oct at 7:00 pm. It is
  off your roster.", `data = {type: 'essentials_cancelled', route: 'home', client_id, date, session_id}`.
- `get_my_auction_results` now returns `result = 'cancelled'` with `won = false` for a cancelled round.

## Edits (mirror of the Android commits of 26 Oct 2026)
1. `src/lib/essentialsAuction.ts`
   - `RoundResult` gains `'cancelled'`.
   - Add:
     ```ts
     export const ESSENTIALS_LOCKED_PREFIX = 'ESSENTIALS_LOCKED';
     export const ESSENTIALS_LOCKED_MESSAGE = 'This Essentials session was booked through the auction. Only the client can cancel it, in the Essentials app.';
     export const isEssentialsLockedError = (message: string | null | undefined): boolean => (message ?? '').includes(ESSENTIALS_LOCKED_PREFIX);
     export type EssentialsCancellation = { round_key: string; client_id: string; client_name: string; training_date: string; slot_time: string; modality: string; cancelled_at: string; session_id: string | null; was_winner: boolean };
     export const cancellationLine = (c: Pick<EssentialsCancellation, 'client_name' | 'modality' | 'training_date' | 'slot_time'>): string =>
       `${c.client_name} cancelled ${c.modality || 'the training'} on ${formatLotDate(c.training_date)}${c.slot_time ? ` at ${formatTime12(c.slot_time)}` : ''}`;
     ```
   - `resultHeadline`: before the last `return`, add
     `if (r.result === 'cancelled') return `${r.client_name}'s ${r.modality} on ${when} was cancelled`;`
2. `src/lib/essentialsAuctionQueries.ts`: `useMyEssentialsCancellations(hours = 48, enabled = true)`, the same shape as
   `useMyAuctionResults` (key `['essentials-cancellations', hours]`, 60 s stale, 5 min refetch, PGRST202 → `[]`),
   mapping the RPC rows to `EssentialsCancellation`.
3. `src/components/essentialsCancelledAlert.tsx` (copy from Android, 70 lines): a rose card "ESSENTIALS · CANCELLED BY
   THE CLIENT", one row per cancellation with `cancellationLine` and "Cancelled in the Essentials app at 3:48 PM IST ·
   the session is no longer on your roster", a Got it chip per row; dismissed keys in AsyncStorage
   `essentials-cancelled-dismissed:<uid>`, pruned to the rounds still served.
4. Mounts: trainer home right after `<EssentialsUnsoldAlert />`; Doctor Dashboard for physios next to the same.
5. `src/components/PushTokenManager.tsx`: `if (t === 'essentials_cancelled') { go(homeRouteFor(roleRef.current)); return; }`
   before the generic route fallback.
6. `src/lib/trainerQueries.ts`, `useCancelScheduledSession`: after the paid-code mapping,
   `isEssentialsLockedError(error.message) ? ESSENTIALS_LOCKED_MESSAGE : error.message`.
7. `tests/rules/auction_rules_test.js`: the four checks added on Android (headline cancelled, detail cancelled,
   cancellation line, locked error true / false / null). Run `node tests/rules/auction_rules_test.js`.

## Verify on a device
- Cancel a session whose roster notes start "Essentials by Odds": the sheet shows the locked message, the row stays.
  A plain session still cancels.
- After the client removes a sold day in the Essentials app: the push arrives, the home shows the rose card, Got it
  hides it, the roster no longer lists the session, the auction page has no card for it.
