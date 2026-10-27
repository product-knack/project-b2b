# iOS handoff: expired-plan gate on My Crew roster making (27 Oct 2026)

For the iOS Expo repo. The Android app got this on 27 Oct 2026. Server side: hub-track migration
`20261028100000_plan_cover_roster_gate.sql` (the owner runs it; until then the read answers PGRST202 and the app
blocks nothing). Feature doc: `b2b/docs/features/android/trainer/plan-cover-roster-gate.md`. Copy rule: no dashes
in user-facing text.

## 1. The rule (owner, 27 Oct 2026)
"If a plan is expired tomorrow or already, and a trainer from my crew tries to make tomorrow's roster, show that
its plan is expired; first make a plan and approve it, then allow it, with a Create plan button."
- Where: the member's **Tomorrow's Plan** sheet and the manager's / physio HOD's **Add Session** in My Crew.
- Gated modalities only: Strength, Yoga, Pilates, Boxing, Aerobics, Aqua Aerobics. Physio, therapy, recovery,
  custom, other: never gated.
- Valid plan: the client's newest approved plan of that modality, by any trainer, 42 days from `approved_at`; an
  approved document plan is always valid.
- **Expired by that day** = `expires_at <= (day + 1) 00:00 IST`. A plan expiring at 10 PM tomorrow is expired for
  tomorrow.
- Never-planned clients are **not** blocked (the 3-session plan-less limit covers them). Essentials clients are
  not enforced. Only an expired plan blocks.
- Unlocks when a new plan of that modality is approved (status approved, approved_at now). While it waits:
  "waiting for approval", no button. Sent back: "needs changes", Open Plan tab.
- Re-sharing an existing crew row (move / update) and adopting a logged row are not gated; only a new session is.

## 2. Server contracts (live after the migration)
| Call | Shape | Notes |
|---|---|---|
| `get_plan_cover(p_client_ids uuid[], p_date date)` | rows `{client_id, modality_key, modality_label, state 'valid' \| 'expired' \| 'none', enforced, blocked, expires_at, last_approved_at, review_state 'in_review' \| 'needs_revision' \| null, review_plan_id}` | one row per client per gated modality the client has any plan row for; staff only (42501); PGRST202 before the migration = block nothing |
| `plan_sync_roster(p_score, p_date, p_entries)` | an entry may now answer `{client_id, schedule_id: null, result: 'plan_expired', replaced_prev, modality, expires_at, review_state}` | other entries still save; keep the entry in the message payload with `roster: 'plan_expired'` |
| `plan_manager_add_session(..., p_force)` | may answer `{result: 'plan_expired', schedule_id: null, modality, expires_at, review_state, client_name}` | before the clash check |

## 3. `src/lib/planCover.ts` (copy byte for byte from the Android repo) + `tests/rules/plan_cover_test.js` (27 checks)
Exports: `modalityKey`, `parsePlanCover` (rows → `clientId → modalityKey → row`), `coverFor(map, clientId,
modality)` → `{blocked, row}`, `isPlanCoverMissing`, `coverDayLabel`, `coverBlockedLine`, `coverReviewLine`,
`coverKicker`, `coverAction` ('create' | 'revise' | null), `coverSendBlockedText`, `isPlanExpiredResult`,
`coverServerRefusedText`, `COVER_CTA` 'Create plan', `COVER_CTA_REVISION` 'Open Plan tab', `COVER_CARD_TAG`
'PLAN EXPIRED · NOT BOOKED', `planModalityFor` ('Strength' → 'Strength Training', the Create Plan modality).

## 4. Data (`managerChatQueries.ts`, append)
```ts
export function usePlanCover(clientIds: (string | null)[], date: string | null | undefined, enabled: boolean) {
  const ids = [...new Set(clientIds.filter(Boolean) as string[])].sort();
  return useQuery({
    queryKey: ['plan-cover', date ?? '', ids.join(',')],
    enabled: enabled && !!date && ids.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<PlanCoverMap> => {
      const { data, error } = await withTimeout(
        Promise.resolve((supabase.rpc as any)('get_plan_cover', { p_client_ids: ids, p_date: date })) as Promise<{ data: any; error: any }>,
        NET_MS, 'Plan check');
      if (error) {
        if (isPlanCoverMissing(error.message) || error.code === 'PGRST202') return {};
        throw new Error(error.message);
      }
      return parsePlanCover(data);
    },
  });
}
```
Invalidate `['plan-cover']` in `useCreateWorkoutPlan.onSuccess` and in the coach's `useProcessCoachPlan.onSuccess`
(the latter also `['plan-expiry-map']`).

## 5. Store and Create Plan
- `store`: `planPrefillModality: string | null` (one-shot; add to the teardown list).
- `createPlan.tsx`: read it once on mount into `prefill` (only when it is one of MODALITIES), clear it, and seed
  `modality` with it when not editing: `useState<PlanModality | null>(editing ? editing.modality : prefill)`.

## 6. UI (`managerChat.tsx`)
**`PlanCoverBox({ row, clientFirst, onCreate, onRevise })`**: a box (red; amber when `reviewState === 'in_review'`)
with the kicker `coverKicker(row.reviewState)`, the line `coverReviewLine(...) ?? coverBlockedLine({clientFirst,
modalityLabel, expiresAt})`, and the button from `coverAction`: Create plan (`onCreate`) or Open Plan tab
(`onRevise`); none while in review. Icons: alert / clock; file / arrowRight.

**Tomorrow's Plan sheet**
- `coverQ = usePlanCover(rows.map(r => r.clientId), composeQ.data?.date, visible)`; `cover = coverQ.data`.
- `createPlanFor(clientId, name, row)`: `set({ selectedClientId, selectedClientName: name, editingPlan: null,
  planPrefillModality: planModalityFor(row.modalityLabel) })`, `onClose()`, `go('create-plan')`.
- In `renderRow`: `verdict = on && !locked ? coverFor(cover, r.clientId, cur?.modality) : {blocked:false,row:null}`;
  render `<PlanCoverBox>` under the row when `verdict.blocked && verdict.row` (onRevise: `onClose();
  openClient(r.clientId, r.name, 'plan')`). The time and modality pills stay usable.
- In `send()`, after the modality check: `planBlocked = entries.filter(e => e.client_id && !(addOnly &&
  lockedIds.has(e.client_id)) && coverFor(cover, e.client_id, e.modality).blocked)`; if any →
  `Alert.alert('Plan expired', coverSendBlockedText(firstNames))` and stop.
- In `sendPlan`, while mapping the sync answers: for a row with `isPlanExpiredResult(r)` collect
  `coverServerRefusedText({clientFirst, modality: r.modality ?? e.modality, expiresAt: r.expires_at})`; after the
  try, `Alert.alert('Plan expired', lines.join('\n\n'))` when any. The entry keeps `roster: r.result`.
- Day card: `e.roster === 'conflict' || e.roster === 'plan_expired'` shows the red tag (`COVER_CARD_TAG` for
  plan_expired) with the existing RETRY BOOKING chip; `retryBooking` shows the same popup on a `plan_expired` answer.

**Add Session modal**
- `coverQ = usePlanCover(clients.map(c => c.clientId), date, visible)`; `verdict = cid && mod ? coverFor(coverQ.data,
  cid, mod) : {blocked:false,row:null}`; `canSave = ... && !verdict.blocked`.
- `<PlanCoverBox>` above the Cancel / Add session row when blocked (onCreate as above with `onClose()` first;
  onRevise opens the client's Plan tab).
- `saveAdd`: `if (res?.result === 'plan_expired') { Alert.alert('Plan expired', coverServerRefusedText({clientFirst,
  modality: res.modality ?? modality, expiresAt: res.expires_at ?? null})); return; }` before the `exists` branch.

## 7. Verify on an iPhone
1. Tomorrow's Plan: pick a client whose Strength plan expired (red strip on the roster card) → the box with
   Create plan under the row; Send → "Plan expired" popup.
2. Create plan → the builder opens with Strength Training picked → save → back in My Crew, reopen the sheet:
   "PLAN WAITING FOR APPROVAL", no button.
3. A coach approves the plan → reopen: no box, Send books the session.
4. Switch the blocked row to Other → sends at once (Other has no plans).
5. Manager Add Session on the same client + Strength: Add session disabled, the box shows; Yoga (never planned)
   adds normally.
6. `node tests/rules/plan_cover_test.js` → 27 PASS.
