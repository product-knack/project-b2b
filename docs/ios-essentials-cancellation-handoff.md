# iOS handoff: a cancelled Essentials day leaves the auction (26 Oct 2026)

For the iOS Expo repo. Server side done (hub-track migration `20261026100000_essentials_client_cancellations.sql`,
run by the owner). Two small app changes, both pure text rules, no new screen. Feature doc:
`b2b/docs/features/android/trainer/essentials-auction.md` section 6, "A cancelled day leaves the auction".

## The rule (owner decisions, 26 Oct 2026)
- The client cancels a planned training in the Essentials app (the day is removed from `essentials_weeks`). The
  server then cancels any roster row booked for it (Cancelled by: Client) and marks the auction round
  `result = 'cancelled'`.
- A trainer, coach, doctor or therapist **cannot cancel a session booked through the auction** (its roster notes
  start "Essentials by Odds"). The server refuses the `session_schedule` update with a message starting
  `ESSENTIALS_LOCKED`. The care team (CRM, admin, ops) cancels it for the client.
- A cancelled round is hidden by `get_essentials_auction` (no card), refused by the booking and the bid RPCs
  ("The client cancelled this session."), and reported by `get_my_auction_results` with `result = 'cancelled'`
  and `won = false` for everyone, the earlier winner included.

## Edits (mirror of the Android commit of 26 Oct 2026)
1. `src/lib/essentialsAuction.ts`
   - `RoundResult` gains `'cancelled'`.
   - Add, next to the other exported constants:
     ```ts
     export const ESSENTIALS_LOCKED_PREFIX = 'ESSENTIALS_LOCKED';
     export const ESSENTIALS_LOCKED_MESSAGE = 'This Essentials session was booked through the auction. Only the care team can cancel it, for the client.';
     export const isEssentialsLockedError = (message: string | null | undefined): boolean => (message ?? '').includes(ESSENTIALS_LOCKED_PREFIX);
     ```
   - `resultHeadline`: before the last `return`, add
     `if (r.result === 'cancelled') return `${r.client_name}'s ${r.modality} on ${when} was cancelled`;`
     (`resultDetail` needs no change: `won` is false, so it prints "Your bid: N of M correct".)
2. `src/lib/trainerQueries.ts`, `useCancelScheduledSession`: after the paid-code mapping,
   `isEssentialsLockedError(error.message) ? ESSENTIALS_LOCKED_MESSAGE : error.message`.
   The doctor and therapist cancel flows share this mutation; nothing else to touch.
3. `tests/rules/auction_rules_test.js`: the three checks added on Android (headline cancelled, detail cancelled,
   locked error true / false / null). Run `node tests/rules/auction_rules_test.js`.

## Verify on a device
- Cancel a session whose roster notes start "Essentials by Odds" as a trainer: the sheet shows the locked message,
  the row stays. A plain session still cancels.
- After the care team cancels an Essentials session for the client: the auction page no longer shows that card;
  the results banner (if you had bid) reads "… was cancelled".
