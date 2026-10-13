# iOS handoff 7 of N: Plan-expiry push to trainers (7 Sep 2026)

Paste this whole doc to the iOS app's coding assistant. Twice a day (10:00 and 19:00 IST) every trainer whose
actively-training client has an approved workout plan with **1 to 3 days left** gets ONE push naming those clients.
The push is sent by the server; the iOS work is small: route the tap, and make sure the trainer's roster cards show
the same "N d left" strip the push is about. Built on Android (odds-app) on 7 Sep 2026.

---

## 0. Ground rules

1. **Everything that decides who is pushed lives on the server.** Do NOT create, alter or run any SQL and do not
   deploy functions. Status on 23 Sep 2026: the SQL part is live (probed: the rule function
   `plan_expiry_push_rows` exists and the log table `plan_expiry_push_log` exists); the edge function
   `notify-plan-expiry` lives in `odds-app/supabase/functions/notify-plan-expiry/` and is deployed by the user.
   If no push ever arrives, tell the user to check the deploy; do not work around it in the app.
2. **Reference implementation** in the Android React Native repo `odds-app`: `routeFromNotification` in
   `src/components/PushTokenManager.tsx` (the tap route), `usePlanExpiryMap` + `PLAN_EXPIRY_DAYS` +
   `PLAN_EXPIRY_WARNING_DAYS` in `src/lib/trainerQueries.ts` (the card rule), and the plan-expiry strip at the top
   of the roster session card in `src/screens/trainer.tsx` (search "Plan expiry strip").
3. The iOS app must already register its push token in `odds_device_tokens` (the same table every staff push
   uses). Nothing new there.

---

## 1. The push (server-side, for reference)
- Title: "1 plan expires soon" or "N plans expire soon".
- Body: up to 4 clients, then "+N more":
  "Riya Mehta (Strength tomorrow, Yoga 3d) · Aman Gupta (Pilates 2d) · +2 more. Make a new plan before they lapse."
  ("tomorrow" when 1 day is left, else "Nd".)
- Data payload: `{ "type": "plan_expiry", "route": "home", "count": "3", "slot": "2026-09-23-am" }`.
- One push per trainer per slot (dedupe by `plan_expiry_push_log`), however many clients.
- Cron (UTC): `30 4 * * *` and `30 13 * * *` = 10:00 and 19:00 IST.

## 2. iOS change 1: route the tap
In the notification-tap handler (both the live listener and the cold-start "last notification response" replay):
```ts
const t = String(data.type ?? '');
// plan_expiry lands on the role's home: the roster cards there carry the amber "N d left" strips.
if (t === 'plan_expiry') { go(homeRouteFor(role)); return; }
```
On Android it shares one line with the other roster alerts:
`if (t === 'far_session_alert' || t === 'longevity_message' || t === 'plan_expiry' || data.route || data.session_id) go(homeRouteFor(role));`
Note `route: 'home'` is not a real route; resolve it to the role's home (for a trainer, the trainer dashboard).
Make sure the data is read from both the notification content and the remote message (APNs / FCM place it
differently when the app was killed).

## 3. iOS change 2: the plan-expiry strip on each roster session card (add it if iOS does not have it)
The push and the strip must always agree, so the rule is identical to the SQL.

### 3.1 The rule (`usePlanExpiryMap(clientIds)`)
```ts
export const PLAN_EXPIRY_DAYS = 42;          // an approved plan is valid 42 days from approved_at
export const PLAN_EXPIRY_WARNING_DAYS = 3;   // the last 3 days are a warning
// query key ['plan-expiry-map', sortedUniqueIds.join(',')], staleTime 60 s. Returns a plain Record, NOT a Map
// (a Map does not survive a persisted react-query cache).
// workout_plan_exercises is ONE ROW PER SET: page past the 1000-row cap.
for (let from = 0; ; from += 1000) {
  const { data } = await supabase.from('workout_plan_exercises')
    .select('client_id, modality, approved_at')
    .in('client_id', ids).eq('status', 'approved').not('approved_at', 'is', null)
    .range(from, from + 999);
  rows.push(...data); if (data.length < 1000) break;
}
// per client, the NEWEST approved_at per normalized modality:
const mod = r.modality === 'Strength Training' ? 'Strength' : (r.modality || 'Training');
// per (client, modality):
const expiry = new Date(approvedAt).getTime() + PLAN_EXPIRY_DAYS * 86400000;
const daysLeft = Math.ceil((expiry - Date.now()) / 86400000);
const item = { modality, daysLeft, expired: Date.now() > expiry, expiringSoon: daysLeft > 0 && daysLeft <= PLAN_EXPIRY_WARNING_DAYS };
// out[clientId] = items sorted by daysLeft ascending; [] when the client has no approved plan at all.
```
The rule is client-level, not trainer-scoped (session logging is blocked on the client's plan whoever approved it).

### 3.2 The strip (top of each roster session card; hidden on cancelled sessions)
- Client has no approved plan (`[]`): a red box with an alert icon: "No approved plan yet. Make a training program
  and get it approved by coach on priority" (red 8% fill, 28% border, text `#E8A79A`, 10.5).
- Otherwise one pill per modality, wrapping:
  - expired: red, alert icon, bold "Strength plan expired" (red 14% fill, 45% border);
  - 1 to 3 days left: gold, alert icon, "Strength · 2d left" (gold 10% fill, 30% border);
  - more left: green, clock icon, "Yoga · 27d left".
- Colors: red `#E76A52`, gold `#E0A53C`, green `#57C98A`; pill radius 999, padding 3.5 x 9, text 10.

## 4. Probe (read-only)
- With the anon key: `POST /rest/v1/rpc/plan_expiry_push_rows` `{ "p_warn_days": 3 }` → 401 `42501 permission denied`
  (correct: it exists and is service-role only). Do not call the edge function: it sends real pushes.
- Ask the user to run `select * from public.plan_expiry_push_rows(3);` in the SQL editor: those trainer / client
  pairs are exactly the ones whose roster cards show a gold "1d / 2d / 3d left" pill.

## 5. Acceptance test
1. A trainer with a client whose plan has 1 to 3 days left sees the gold pill on that client's roster card, with the
   same number the SQL dry run shows.
2. After 10:00 or 19:00 IST (once the function is deployed) the trainer's iPhone gets "N plans expire soon"; tapping
   it, from background and from a killed app, opens the trainer home.
3. `select * from public.plan_expiry_push_log order by sent_at desc limit 20;` shows one row per trainer per slot.
4. Expired plans show red on the card and are never in the push (by design: the push is for "going to expire").

## 6. If the iOS app is not React Native
Handle `userInfo["type"] as? String == "plan_expiry"` in `userNotificationCenter(_:didReceive:)` and route to the
trainer home; compute the strip with the same query and formula in Swift (`ceil((approved_at + 42 days - now) / 1 day)`).
