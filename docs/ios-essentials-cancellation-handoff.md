# iOS handoff: the client cancels an Essentials day, the session leaves the auction (end to end, 26 Oct 2026)

For the iOS Expo repo. Self-contained: the feature, the server contracts (all live), the exact Android code to
copy, where it mounts, and how to verify. Android: odds-app commit 5ed82d9 (26 Oct 2026). Server: hub-track
migration `20261026100000_essentials_client_cancellations.sql`, run live 26 Oct 2026. Feature doc:
`b2b/docs/features/android/trainer/essentials-auction.md` section 6, "A cancelled day leaves the auction".
Copy rule: no dashes in user-facing text; "client", "session" (never "lot"), times as 7:00 PM.

## 1. The feature in one page
1. Only the client cancels an Essentials training, as a **rest day in the Essentials app** (the client app's
   `essentials_set_days` drops the date from `essentials_weeks.days`, history line `remove`; it never touches
   `session_schedule`). Nobody on the staff side (trainer, physio, CRM, admin) cancels a session booked through
   the auction: the roster update is refused with `ESSENTIALS_LOCKED`.
2. **Before the auction** (the client removes the day in the morning): the auction reads `essentials_weeks` live,
   so the card is never built. Nothing to do in the app.
3. **During the auction** (1:00 to 5:30 PM, bids in, nobody booked): the card disappears at the next refresh
   (the auction page re-reads every 15 s); a bid or a perfect score answers "The client cancelled this session.";
   the round is marked `cancelled`, so the 5:30 PM run skips it and every bidder's results card reads
   "Aarav Mehra's Strength on Tue 27 Oct at 7:00 PM was cancelled".
4. **After the sale** (an expert is booked): the server cancels the roster row itself (Cancelled by: Client,
   "Cancelled by the client in the Essentials app"), marks the round, **pushes the trainer** and lists the
   cancellation for the **dashboard alert** (rose card, Got it dismisses), writes a care-team note. The manager's
   unsold list, the crews push and the assign step skip it. Today the Essentials app locks tomorrow once an
   expert is booked, so this path only runs when that lock changes on the client side; the server handles it
   whenever it happens.
5. A day planned again reopens the round (bids cleared) and the auction lists it again.

## 2. Server contracts (live, nothing to port)
| Call | Shape | Notes |
|---|---|---|
| `get_essentials_auction(p_date, p_as_manager)` | unchanged columns; a cancelled round is simply **absent** | `round_result` can now also be `'cancelled'` on rows read elsewhere, never on this list |
| `submit_essentials_bid(...)` | error `The client cancelled this session.` on a cancelled round | the existing error path shows the server sentence |
| `get_my_auction_results(p_hours)` | `result = 'cancelled'`, `won = false` for everyone on a cancelled round | the results card text changes (section 3) |
| **`get_my_essentials_cancellations(p_hours int default 48)`** (new) | rows `{round_key text, client_id uuid, client_name text, training_date date, slot_time text "19:00", modality text, cancelled_at timestamptz, session_id uuid \| null, was_winner boolean}` | the signed-in trainer's sessions the client cancelled (winner of the round, or the cancelled roster row's trainer), newest first; `PGRST202` before the migration means "no alert" |
| `session_schedule` update to `status = 'cancelled'` on a row whose notes start "Essentials by Odds" | refused: message starts `ESSENTIALS_LOCKED:` | any signed-in role; the app maps it to the friendly copy |
| Push to the trainer (edge `notify-essentials-unsold`, a generic staff push, posted by the SQL trigger) | title `Essentials session cancelled`, body `NAME cancelled Strength on 27 Oct at 7:00 pm. It is off your roster.`, `data = {type: 'essentials_cancelled', route: 'home', client_id, date, session_id}` | the push route lands on the home, where the alert sits |

The round json (`client_health_summary.auction`) carries `result 'cancelled'`, `prior_result`, `cancelled {at, who 'client',
by, remark, session_id}`; a reopened round carries `reopened {at, by, from}`. The app never reads that json directly.

## 3. Edits, exact Android code

### 3.1 `src/lib/essentialsAuction.ts`
`RoundResult` gains `'cancelled'`:
```ts
export type RoundResult = 'won' | 'booked_elsewhere' | 'no_bids' | 'no_winner' | 'cancelled' | null;
```
Add next to it:
```ts
/* Nobody on the staff side cancels a session booked through the auction (owner, 26 Oct 2026): the server
   refuses with ESSENTIALS_LOCKED; only the client cancels it, as a rest day in the Essentials app. */
export const ESSENTIALS_LOCKED_PREFIX = 'ESSENTIALS_LOCKED';
export const ESSENTIALS_LOCKED_MESSAGE = 'This Essentials session was booked through the auction. Only the client can cancel it, in the Essentials app.';
export const isEssentialsLockedError = (message: string | null | undefined): boolean => (message ?? '').includes(ESSENTIALS_LOCKED_PREFIX);

/** One row of get_my_essentials_cancellations: a session of mine the client cancelled in the app (26 Oct 2026). */
export type EssentialsCancellation = {
  round_key: string;
  client_id: string;
  client_name: string;
  training_date: string;
  slot_time: string;
  modality: string;
  cancelled_at: string;
  session_id: string | null;
  was_winner: boolean;
};

/** The dashboard alert line: "Aarav Mehra cancelled Strength on Tue 27 Oct at 7:00 PM". */
export const cancellationLine = (c: Pick<EssentialsCancellation, 'client_name' | 'modality' | 'training_date' | 'slot_time'>): string =>
  `${c.client_name} cancelled ${c.modality || 'the training'} on ${formatLotDate(c.training_date)}${c.slot_time ? ` at ${formatTime12(c.slot_time)}` : ''}`;
```
In `resultHeadline`, before the last `return`:
```ts
if (r.result === 'cancelled') return `${r.client_name}'s ${r.modality} on ${when} was cancelled`;
```
(`resultDetail` needs no change: `won` is false, so it prints "Your bid: N of M correct".)

### 3.2 `src/lib/essentialsAuctionQueries.ts`
Add `import type { EssentialsCancellation } from './essentialsAuction';` and append:
```ts
/* ---------- the client cancelled a session of mine (26 Oct 2026) ---------- */
/** get_my_essentials_cancellations: my sessions the client cancelled in the Essentials app in the last hours (the dashboard alert). */
export function useMyEssentialsCancellations(hours = 48, enabled = true) {
  return useQuery({
    queryKey: ['essentials-cancellations', hours],
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 5 * 60_000 : false,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<EssentialsCancellation[]> => {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('get_my_essentials_cancellations', { p_hours: hours })) as Promise<RpcResult>,
        NET_MS, 'Essentials cancellations');
      if (error) {
        if (error.code === 'PGRST202' || /PGRST202|could not find the function/i.test(String(error.message ?? ''))) return [];
        throw new Error(describeGrabError(error));
      }
      return ((data ?? []) as any[]).map((r) => ({
        round_key: String(r.round_key ?? `${r.client_id}:${r.training_date}`),
        client_id: String(r.client_id),
        client_name: r.client_name ?? 'Client',
        training_date: String(r.training_date),
        slot_time: String(r.slot_time ?? '').slice(0, 5),
        modality: r.modality ?? '',
        cancelled_at: String(r.cancelled_at),
        session_id: r.session_id ?? null,
        was_winner: !!r.was_winner,
      }));
    },
  });
}
```
(`RpcResult`, `withTimeout`, `NET_MS`, `describeGrabError` are the ones `useMyAuctionResults` already uses in that file.)

### 3.3 `src/components/essentialsCancelledAlert.tsx` (new, copy whole)
```tsx
/* Essentials Auction: the client cancelled a session of mine (26 Oct 2026, owner: "after the auction, if a
   client's session was sold and the client cancels, push the trainer and show an alert on the dashboard").
   The server lists my cancelled sessions of the last 48 hours (get_my_essentials_cancellations); a card
   dismissed with Got it stays hidden on this device for that user (AsyncStorage, pruned to the rounds still
   served). Mounted on the trainer home and the physio's Doctor Dashboard next to the unsold alert. */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { useAuth } from '../auth';
import { useMyEssentialsCancellations } from '../lib/essentialsAuctionQueries';
import { cancellationLine, istClock } from '../lib/essentialsAuction';

const ROSE = '#F06A8A';
const HOURS = 48;
const keyFor = (uid: string) => `essentials-cancelled-dismissed:${uid}`;

export function EssentialsCancelledAlert() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const q = useMyEssentialsCancellations(HOURS, !!uid);
  const [dismissed, setDismissed] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    if (!uid) return;
    let alive = true;
    AsyncStorage.getItem(keyFor(uid)).then((raw) => {
      if (!alive) return;
      try { const arr = raw ? JSON.parse(raw) : []; setDismissed(Array.isArray(arr) ? arr : []); } catch { setDismissed([]); }
    }).catch(() => { if (alive) setDismissed([]); });
    return () => { alive = false; };
  }, [uid]);
  const rows = q.data ?? [];
  const visible = dismissed ? rows.filter((r) => !dismissed.includes(r.round_key)) : [];
  const dismiss = (key: string) => {
    if (!uid) return;
    const next = [...(dismissed ?? []), key].filter((k) => rows.some((r) => r.round_key === k));
    setDismissed(next);
    AsyncStorage.setItem(keyFor(uid), JSON.stringify(next)).catch(() => {});
  };
  if (!visible.length) return null;
  return (
    <View style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: hexA(ROSE, 0.45) }}>
      <LinearGradient colors={['rgba(70,26,40,0.7)', 'rgba(22,12,16,0.9)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(ROSE, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="gavel" size={15} color={ROSE} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.9, color: ROSE }}>ESSENTIALS · CANCELLED BY THE CLIENT</Mono>
            <Serif style={{ fontSize: 16, marginTop: 1 }}>{visible.length === 1 ? 'A session is off your roster' : `${visible.length} sessions are off your roster`}</Serif>
          </View>
        </View>
        {visible.slice(0, 3).map((r) => (
          <View key={r.round_key} accessibilityLiveRegion="polite"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(ROSE, 0.22) }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }} numberOfLines={2}>{cancellationLine(r)}</Text>
              <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>Cancelled in the Essentials app at {istClock(r.cancelled_at)} IST · the session is no longer on your roster</Body>
            </View>
            <Pressable onPress={() => dismiss(r.round_key)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Got it, ${r.client_name}`}
              style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(ROSE, 0.16), borderWidth: 1, borderColor: hexA(ROSE, 0.45) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: ROSE }}>Got it</Text>
            </Pressable>
          </View>
        ))}
      </LinearGradient>
    </View>
  );
}
```

### 3.4 Mounts
- `src/screens/trainer.tsx` (the trainer home): right after `<EssentialsUnsoldAlert />` add `<EssentialsCancelledAlert />`.
- `src/screens/doctor.tsx` (the Doctor Dashboard, physios only): after
  `{identity.data.isPhysio ? <EssentialsUnsoldAlert /> : null}` add
  `{identity.data.isPhysio ? <EssentialsCancelledAlert /> : null}`.
- Import `{ EssentialsCancelledAlert } from '../components/essentialsCancelledAlert'` in both.

### 3.5 `src/components/PushTokenManager.tsx`
In the tap handler, after the `essentials_unsold_manager` line and before the generic route fallback:
```ts
// The client cancelled a sold Essentials session (26 Oct 2026): home, where the alert card sits.
if (t === 'essentials_cancelled') { go(homeRouteFor(roleRef.current)); return; }
```

### 3.6 `src/lib/trainerQueries.ts`, `useCancelScheduledSession`
Import `{ ESSENTIALS_LOCKED_MESSAGE, isEssentialsLockedError } from './essentialsAuction'` and map the error after
the paid-code gate:
```ts
if (error) throw new Error(isPaidCancelGateError(error.message) ? PAID_CANCEL_GATE_MESSAGE : isEssentialsLockedError(error.message) ? ESSENTIALS_LOCKED_MESSAGE : error.message);
```
The doctor and therapist cancel flows share this mutation; nothing else to touch.

### 3.7 `tests/rules/auction_rules_test.js`
```js
// 26 Oct 2026: a cancelled day (the server reports won = false to everyone, the ex-winner included)
eq('headline cancelled', A.resultHeadline({ ...res, result: 'cancelled' }), "Aarav Mehra's Strength on Fri 2 Oct at 7:00 AM was cancelled");
eq('detail cancelled is the bid only', A.resultDetail({ ...res, result: 'cancelled' }), 'Your bid: 4 of 5 correct');
eq('cancellation line', A.cancellationLine({ client_name: 'Aarav Mehra', modality: 'Strength', training_date: '2026-10-02', slot_time: '07:00' }), 'Aarav Mehra cancelled Strength on Fri 2 Oct at 7:00 AM');
eq('locked error', [A.isEssentialsLockedError('ESSENTIALS_LOCKED: this Essentials session was booked through the auction.'), A.isEssentialsLockedError('PAID_CANCEL_CODE_REQUIRED: x'), A.isEssentialsLockedError(null)], [true, false, false]);
```
Run `node tests/rules/auction_rules_test.js`.

## 4. Verify on an iPhone
1. **Locked for staff:** as a trainer, cancel a roster session whose notes start "Essentials by Odds": the sheet
   shows "This Essentials session was booked through the auction. Only the client can cancel it, in the
   Essentials app." and the row stays. A plain session still cancels.
2. **Hidden from the auction:** after the client removes a planned day, the auction page has no card for it.
3. **Results:** a trainer who had bid on it sees "…was cancelled" on the results card (home and auction page).
4. **Sold then cancelled:** the push arrives ("Essentials session cancelled"), tapping it opens the home, the rose
   card lists the session with the time, Got it hides it (stays hidden after a restart), the roster no longer
   shows the session.
5. Read-only SQL check for the owner: `select client_id, briefing_date, auction->>'result', auction->'cancelled'
   from client_health_summary where auction->>'result' = 'cancelled' order by briefing_date desc limit 5;`

## 5. Nothing else
No new screen, no store change, no capability change. Web has the same banner (`EssentialsCancelledBanner`) on
the trainer dashboard. No build was made on Android (builds on request only).
