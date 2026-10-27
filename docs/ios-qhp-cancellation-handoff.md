# iOS handoff: QHP cancellation requests, paid or unpaid (26 Oct 2026)

For the iOS Expo repo. Server side live since 14 Oct 2026 (nothing to port). Android built 26 Oct 2026 (odds-app).
Full server contract and shapes: `odds-app/docs/qhp-paid-cancellation-context.md`. Feature doc:
`b2b/docs/features/android/trainer/qhp-cancellation-request.md`. Copy rule: no dashes, "QHP Manager",
"paid cancellation", "unpaid".

## The rule
The assessor never cancels a QHP: they request it (reason + paid / unpaid claim), the QHP stays scheduled, the QHP
Manager approves (confirming the final paid / unpaid, which Plutus pays and QHP Stats counts) or declines with a note.
The app only reads `coach_assessment.cancelled` and `coach_assessment.cancellation_request` and calls three RPCs;
it never writes either column.

## Files to copy byte for byte from the Android repo
- `src/lib/qhpCancellation.ts` (pure: `cancelViewOf`, `cancelChip`, `cancelDetail`, `isPaidCancellation`,
  `matchesFilter`, `cancelSortKey`, `canRequestCancellation`, `istDay`, the copy, `qhpCancelCodeText`).
- `tests/rules/qhp_cancellation_test.js` (22 checks).
- `src/lib/qhpCancellationQueries.ts` (`useRequestQhpCancellation`, `useWithdrawQhpCancellation`,
  `useDecideQhpCancellation`, `useQhpCancellationRequests(status, enabled)`; needs the iOS copies of
  `./supabase`, `./withTimeout`, `./friendlyError`, `./offline` (`getIsOnline`)).
- `src/components/qhpCancellation.tsx` (`CancelChipView`, `QhpCancelRow`, `RequestCancellationSheet`,
  `WithdrawButton`, `DecideCancellationSheet`, `qhpSlotLine`; needs `../lib/useKeyboardHeight`).

## Edits
1. `src/lib/qhpQueries.ts`: `QhpRow` gains `cancelled`, `cancellation_request`, `cancel_view: CancelView`
   (mapped from the row with `cancelViewOf(r)`); Upcoming excludes `r.cancelled`; `QhpLists` gains
   `cancellations` (rows whose view is not `none`, sorted by `cancelSortKey` descending).
2. `src/store.tsx`: `qhpFocusTab: string | null` and `qhpManagerFocusTab: string | null` (default null, reset on
   sign-out).
3. `src/components/PushTokenManager.tsx`, before the generic fallback:
   `qhp_cancel_requested` → `set({ qhpManagerFocusTab: 'cancellations' }); go('qhp-manager')`;
   `qhp_cancel_declined` / `qhp_cancelled` → `set({ qhpFocusTab: 'cancellations' }); go('qhp')`.
4. QHP page (`Qhp()`): the view union gains `'cancellations'`; a fifth tab **Cancelled** with the pending count;
   the tab body: filter chips All / Pending / Approved, the counting line, `QhpCancelRow` per row with
   `WithdrawButton` (pending) or a Request again button (declined); on each Upcoming card, after the reschedule
   badges: `CancelChipView` + `cancelDetail(view, true)` + `WithdrawButton` when pending, and the
   **Request cancellation** button when `canRequestCancellation(q, q.cancel_view)`; `<RequestCancellationSheet
   target={cancelFor} onClose=…/>` next to the reschedule sheet. On mount, `store.qhpFocusTab === 'cancellations'`
   selects the tab once and clears the key.
5. QHP Manager (`QhpManager()`): the tab union gains `'cancellations'`; `useQhpCancellationRequests('pending',
   isMgr)` feeds the badge, `('decided', isMgr && tab === 'cancellations')` the second segment; the tab body:
   Pending / Decided segments, `QhpCancelRow` per request with Approve and Decline (pending) opening
   `DecideCancellationSheet` (`mode: 'approve' | 'decline'`, `claim` = the assessor's claim). The one-shot
   `qhpManagerFocusTab` selects the tab.

## Verify on an iPhone
Request as paid (amber chip, the manager's push and tab), withdraw, decline with a note (red chip + note, Request
again), approve keeping paid ("Paid cancellation", the QHP leaves Upcoming, Plutus lists it), approve as unpaid
("Cancelled · Unpaid", "You asked for paid"), decide twice from two devices ("already decided").
`node tests/rules/qhp_cancellation_test.js`.
