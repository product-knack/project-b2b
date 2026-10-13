# iOS delta: Essentials Auction, changes after the first handoff (1 Oct 2026, afternoon)

Paste this to the iOS app's coding assistant **after** `ios-essentials-auction-handoff.md`. It changes four things
in that document; everything else there stands. Android reference files per item. Nothing new on the server
beyond one config value; do NOT run SQL.

## 1. The window is 1:00 PM to 4:00 PM IST (was 11:30 AM to 2:00 PM)
- Live: `essentials_auction_config()` now returns `{ "open": "13:00", "close": "16:00", "reserve_minutes": 30,
  "tz": "Asia/Kolkata" }` (migration `20261001220000_essentials_auction_window.sql`). The preferred trainer's head
  start is therefore 1:00 to 1:30 PM. Both RPCs read the config on every call; nothing else changed.
- App: `DEFAULT_AUCTION_CONFIG = { open: '13:00', close: '16:00', reserve_minutes: 30 }` (fallback only, never
  hard-code the window elsewhere). `useAuctionConfig()` is no longer cached for the whole session: `staleTime` and
  `refetchInterval` 10 minutes, so a change in the database reaches open apps.
- Every string derived from the config follows automatically ("WINDOW 1:00 PM TO 4:00 PM IST", "Opens at 1:00 PM
  · in 1h 30m", "Closed for today · reopens 1:00 PM", "CLOSED AT 4:00 PM", "Reserved for Riya Sen until 1:30 PM").
  If any of those were typed as literals, remove the literals.
- Offline tests, new expectations for the window (`windowState` with the defaults): 11:00 -> before, 120 min left;
  12:59 -> before; 13:00 -> open, 180 min; 15:59 -> open, 1 min; 16:00 -> after; 23:30 -> after; 00:10 -> before,
  770 min; `opensAt '1:00 PM'`, `closesAt '4:00 PM'`; `canGrab` before the window -> "Opens at 1:00 PM"; a reserved
  lot with `reserved_until` at 13:30 IST -> "Reserved for Riya Sen until 1:30 PM" for others, ok for the preferred
  trainer.

## 2. QHP front-view photo on the session card
(Android: `useAuctionClientPhotos` in `src/lib/essentialsAuctionQueries.ts`; `ClientFace` and `PhotoLightbox` in
`src/screens/essentialsAuction.tsx`.)
- Data: `qhp_details` is readable by trainers and physios (probed as Sagar for a client not assigned to him). For
  the listed `client_id`s: `select client_id, created_at, ref: qhp_json->postural_assessment->front_view->>photo_reference,
  url: qhp_json->postural_assessment->front_view->>photo_url` where `client_id in (ids)`, newest first, `limit
  ids.length * 6`. Per client keep the first value that starts with `http` (recent reports hold a public URL in the
  `qhp-images` bucket, e.g. `https://agtjszjedaenclbzgjvi.supabase.co/storage/v1/object/public/qhp-images/<client_id>/postural_front_<ts>.jpeg`;
  older reports hold the placeholder word `front_view_image`, skip it). Key `['essentials-auction-photos', ids]`,
  `staleTime` 5 min, `withTimeout`; on any error return `{}` (the photo is a nicety, never break the page).
- Card: with a photo, replace the initials avatar by a 56 px rounded photo (radius about a third of the size,
  1.5 px gold edge, a small dark strip at its bottom reading QHP in gold mono), and the line "TAP THE PHOTO FOR
  THE QHP FRONT VIEW" (small mono) under "Essentials by Odds · Fri 2 Oct". Tap opens a lightbox: own Modal, black
  94% backdrop (tap closes), the image `contain` at full width, caption "<NAME> · QHP FRONT VIEW" in gold mono, a
  Close pill. The ticket dialog shows the same photo at 44 px beside the client name. No photo, or an image that
  fails to load: the initials avatar exactly as before.
- Today Maya Rao Tech and Sunita Verma tech have only the placeholder, so they show initials; most other clients
  with a 2026 report have a real URL.

## 3. My Crew: Essentials sessions cannot be rescheduled from the day card
(Android: `useClientsEssentials` in `src/lib/managerChatQueries.ts`; `managerChat.tsx` day-card rows.)
- Data: for the client ids on the card, `select id, subscription_type, essentials_extensions from clients`, key
  `['mgr-client-essentials', ids]`, `staleTime` 5 min; status through the same `computeEssentials` the client
  cards use (Essentials = `subscription_type` equals "essentials" case-insensitively; the newest
  `essentials_extensions` entry is the current pass; states active / expiring (3 days or less) / vacation /
  expired / upcoming).
- Rule: on every day-card row whose client is on Essentials by Odds (any entry, not only auction ones): the
  manager's time pill is **disabled** (no reschedule from My Crew; the plan moves only through its own rules) and
  the member's RESCHEDULE request chip is **hidden**. Manager Add Session and everything else unchanged.

## 4. ESSENTIALS badge in My Crew
- The compact ESSENTIALS pill (the same component as on the client cards: gold gradient, award icon, mono text,
  state suffix `· 2D LEFT` / `· LAST DAY` (orange), `· VACATION` (purple), `· ENDED` (red), `· SOON` (blue), plain
  `ESSENTIALS` while the pass runs) on every day-card row and every Tomorrow's Plan compose row whose client is on
  Essentials, placed before the PROTOCOL chip, after the cycle chip.

## 5. Never the same trainer two days in a row (server rule, nothing to build, one sentence to expect)
- Live once migration `20261001230000_essentials_auction_no_consecutive.sql` is run: `get_essentials_auction`
  no longer returns a client's lot to a trainer or physio who has that client on the auction day (any
  non-cancelled `session_schedule` row or logged `training_sessions` row, helper `essentials_trained_on`); the
  lot for the day after shows again. Staff (admin / ops / crm) still get every row. A usual (CRM-set) trainer in
  that position gets no head start (`status 'open'`, `reserved_until null`).
- `grab_essentials_session` refuses such a grab with "You have <client> today. Tomorrow's session goes to
  another trainer." Show it like any other sentence (red banner, refetch). No app logic: do not filter locally.

## 6. ETA on the session card (build this; Android: `useAuctionEta` in `src/lib/essentialsAuctionQueries.ts`, `computeLotEta` and friends in `src/lib/essentialsAuction.ts`, `EtaBlock` / `EtaRow` in `src/screens/essentialsAuction.tsx`)
- Data, three reads trainers and physios are allowed, all `withTimeout`, any error -> no ETA block:
  1. `clients` `select id, brb_location, location` for the listed client ids. `brb_location` is
     `{ lat, lng, method, accuracy, updated_at, captured_by }` (26 clients have it); `location` is a free address.
  2. `coach_assessment` `select client_id, assessment_date, location` for those ids, `location not null`, newest
     first, `limit ids.length * 4`; first non-empty per client = the latest QHP's location text.
  3. The signed-in trainer's own `session_schedule` rows of the auction day: `select id, scheduled_datetime,
     modality, status, client_id, clients:client_id(first_name, last_name, brb_location, location)` where
     `trainer_id = me`, `scheduled_datetime` within `[date 00:00, date 23:59:59.999]` IST, `status <> 'cancelled'`.
  Key `['essentials-auction-eta', me, date + client ids + slots]`, `staleTime` 60 s.
- Pure rules (port and unit-test):
  - `approxTravel(a, b)`: haversine km ×1.35 (road), minutes = km / 22 km/h × 60, min 1 (the same offline estimate
    the roster card uses).
  - `geoFromBrb(v)`: `{lat, lng}` when both are finite numbers and not both 0, else null.
  - `computeLotEta(lotStartIso, lotLoc, lotLocText, sessions)`: neighbours = the trainer's sessions within
    180 min before (nearest = `prev`) and after (nearest = `next`) the lot; sessions count as 60 min;
    `gapMin` = end of the earlier to start of the later (negative = overlap); `etaMin`/`km` from
    `approxTravel` when both the lot and the neighbour have pins, else null; `tight` = `etaMin > gapMin`, or
    `gapMin < 0` when there is no estimate; result `{ loc, locText, prev, next, tight }`. The lot's own slot is
    excluded. `locText` = `clients.location`, else the QHP location.
  - Test values: lot 09:00 IST, Hauz Khas pin; sessions 05:30 (excluded), 07:00 near (prev: gap 60, ok), 10:30
    Pitampura (next: gap 30, drive > 30 -> tight), 13:00 (excluded); no lot pin -> `etaMin null`, not tight,
    `locText` kept; a 09:30 neighbour without pins -> gap -30, tight.
- Card (not on grabbed cards; hidden when there is no neighbour and no location): a blue box (red when tight)
  "ETA · YOUR SESSIONS AROUND IT" (+ a red TIGHT TRAVEL pill); the client line: with a pin "CLIENT · <address>"
  if any, without a pin "CLIENT · <address> (FROM THE QHP, NO MAP PIN)" or "CLIENT · NO LOCATION ON FILE YET";
  one row per neighbour, arrow left/right, "Before: 7:00 AM · Riya Sen · Strength" and a mono line
  "~25 MIN DRIVE · 6.2 KM · 1 HR GAP · OK" (green) / "… · 30 MIN GAP · TIGHT" (red) / the neighbour's address
  or "NO MAP PIN" when the drive cannot be estimated; "NO SESSION OF YOURS WITHIN 3 HOURS OF IT" when none;
  footer "ROAD ESTIMATE FROM THE CLIENTS' MAP PINS · SESSIONS TAKEN AS 60 MIN". `formatMinutes`: "25 min",
  "1 hr", "1 hr 10 min".
- Warning popup: tapping Book my session on a tight lot shows an alert "Tight travel" with one line per tight
  neighbour ("10:30 AM with Karan Mehta: about 1 hr by road, you would have 30 min." / "… the sessions
  overlap.") and "Book it anyway?" with Not now / Book anyway; Book anyway opens the ticket, which repeats the
  lines in a red TIGHT TRAVEL box above BEFORE YOU BOOK. The ETA never blocks a booking and the server knows
  nothing about it.

## Verify
- ETA, read-only as Sagar: the three selects above answer 200 (his own sessions, any client's `brb_location`,
  any client's `coach_assessment.location`).
- Two-day rule, read-only: as Sagar on a day he has a session with an Essentials client, `get_essentials_auction`
  omits that client; as admin with `p_date` = tomorrow the row is still there.
- Config probe as Sagar: `essentials_auction_config` -> `open '13:00'`, `close '16:00'`.
- Photos: as Sagar, the `qhp_details` select above for `4645052b-31db-42ef-980a-b7e58916e98e` returns a
  `https://.../qhp-images/...` value; for `fa2af0c8-cab8-444a-94e7-e59113cd9d36` only `front_view_image`.
- Device, inside 1:00 PM to 4:00 PM IST: the LIVE pill and the home card appear at 1:00 PM and leave at 4:00 PM;
  a session card of a client with a QHP photo shows the photo and the lightbox opens; in My Crew an Essentials
  client's row shows the badge and the manager cannot tap its time pill.
