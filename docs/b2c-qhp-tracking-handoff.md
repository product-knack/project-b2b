# B2C handoff: your QHP and the assessor on the way, in the client app (20 Oct 2026)

Paste this whole document to the client app's coding assistant (the iOS app shown to clients as "Odds Longevity",
with its FastAPI backend on Railway, on the same Supabase project `agtjszjedaenclbzgjvi`). It builds the member's
side of the QHP visit: a card for the upcoming QHP (date, time, assessor, address), a map that shows the assessor
riding to the member's home with the minutes left, and a screen where the member sets their home pin so the
assessor can navigate to them. The member reads through one function and writes through one function; nothing
here changes a staff app.

## Read this first: the state of the assessor side
The staff app can publish the assessor's ride (built 14 Oct 2026), but that feature is **parked**: zero rides have
been published so far, because almost no client has a home pin before their first QHP, and the assessor's
navigation needs the pin. So:
- Build everything below now. Without a ride the map screen shows the home pin, the address and the QHP details,
  and the status line reads "We will show the assessor here when they set off".
- The **home pin screen is the valuable part today**: a member who sets their pin makes the assessor's
  navigation, and with it the live ride, possible for the first time.
- Live rides appear the day the office switches the assessor side on. Nothing in the client app changes then.

## How to work through this document
1. Build in the order of the sections; after each report what the app already had, what you changed, what you
   verified. Type-check before moving on.
2. Do NOT create, alter or run any SQL, policy, trigger or function. The owner runs the one migration below
   (`20261020130000_qhp_tracking_member.sql` in the hub-track repo) before you start; section 5 tells you how to
   check it is live.
3. Probe read-only first (section 5). Never write a home pin for a real member while testing: use your own test
   member account.
4. Copy rules for members: plain words, commas instead of dashes, "QHP" is fine (members know the word), "the
   assessor" for the staff member, India time on every date and clock, no code words (never show `on_the_way`
   raw). Call the person "you".
5. Privacy: the assessor's first name and phone may be shown (staff numbers are fine); never show another
   member's anything. The map screen shows the member's own home and the assessor's position: add it to the
   session-replay exclusion list if the app has one. Location permission is asked once, in the foreground, only
   on the home pin screen; no background location, ever.

Staff reference: hub-track `docs/features/web/ops/route-tracker.md` (the office side), Android
`docs/features/android/trainer/route-tracker.md` and `qhp-navigation.md` (the assessor side), the audit
`odds-app/docs/route-tracker-audit-20oct.md`.

---

## 0. What it is

An assessor visits the member at home for a QHP (the quality health profile assessment). The office schedules it
(`coach_assessment`: date, time, address, assessor). When the assessor taps Start navigation in the staff app,
the server keeps one row per QHP in `route_tracker` with the assessor's position every few seconds, the planned
route, the minutes left, and later the arrival and the end. The member's app shows: the upcoming QHP, the assessor
on a map while they ride, "arrived" when they are at the door, and, before any of that, a way to set the home pin.

---

## 1. Backend contract (the owner runs the migration once; then everything is live, read-only except the pin)

Member identity everywhere: `clients.profile_id = auth.uid()`, the same rule as `get_my_session_otps`.

### 1.1 RPC `get_my_qhp_tracking(p_days integer default 14)` (the one read)
`supabase.rpc('get_my_qhp_tracking', { p_days: 14 })` with the member's JWT. SECURITY DEFINER. Returns the
member's QHPs from India today for `p_days` days (1 to 60), soonest first; `[]` for an account that is not a
member, and for a member with no QHP in the window.

| column | type | meaning |
|---|---|---|
| `assessment_id` | uuid | the QHP; the key for the ride topic (section 1.3) |
| `assessment_date` | date | India date of the visit |
| `assessment_time` | time or null | India clock of the visit, `HH:MM:SS` |
| `address` | text or null | the address the office typed when scheduling |
| `status` | text | `scheduled`, `completed` or `cancelled` |
| `assessor_first_name` | text or null | the assessor's first name (null until one is assigned) |
| `assessor_phone` | text or null | the assessor's phone, for a Call button |
| `home_pin` | jsonb or null | `{ lat, lng, method, updated_at }`, the member's own pin |
| `ride` | jsonb or null | null until the assessor sets off; keys below |

`ride` keys: `status` (`on_the_way`, `arrived`, `stale`, `ended`), `lat`, `lng` (the assessor's last position),
`updated_at` (server time of the last write), `started_at`, `ended_at`, `eta_min` (minutes left, may be null),
`distance_km` (may be null), `heading` (degrees, may be null), `fix_at` (the phone's time of the last GPS fix, ISO),
`planned_polyline` (the route at the start, Google encoded), `polyline` (the ridden trail so far, Google encoded,
refreshed about every minute), `planned_min`, `arrived_at`, `ended_by` (`arrived`, `ended` or `timeout`),
`assessor_name` (full name as recorded at the start). No GPS points, no lead, no other member.

Status meanings: `on_the_way` = positions arriving; `stale` = no position for 10 minutes (the phone is locked, or
no signal); `arrived` = within about 60 metres of the pin; `ended` = the assessor exited or the ride timed out.

### 1.2 RPC `set_my_home_location(p_lat, p_lng, p_accuracy_m default null, p_method default 'client_app_pin')` (the one write)
`supabase.rpc('set_my_home_location', { p_lat, p_lng, p_accuracy_m, p_method })`. SECURITY DEFINER. Writes the
member's own `clients.brb_location` as `{ lat, lng, method, accuracy, updated_at, captured_by }`, the json every
staff surface and the assessor's navigation already read, and returns that json. Methods: `client_app_gps` (the
phone's position, only after the member confirms they are at home), `client_app_pin` (a pin moved on the map),
`client_app_paste` (coordinates parsed from a Google Maps link). Errors, by prefix: `PIN_NO_MEMBER` (not a
member), `PIN_BAD_COORDS`, `PIN_OUTSIDE_INDIA` (a typo guard: lat 6 to 36, lng 68 to 98), `PIN_BAD_METHOD`.
It overwrites a pin captured by staff: the member knows their home.

### 1.3 Realtime (optional, only after section 4 works with polling)
The server broadcasts every position write to the private topic `route:<assessment_id>` (event `position`,
payload `{ assessment_id, status, lat, lng, live: { heading, speed_mps, accuracy_m, eta_min, distance_km, fix_at },
updated_at, started_at, ended_at }`). After the migration the member may subscribe to their own QHP's topic:
`supabase.realtime.setAuth(<member jwt>)` once, then `supabase.channel('route:' + assessmentId, { config: { private: true } })
.on('broadcast', { event: 'position' }, ...)`. A refused join (`CHANNEL_ERROR`) must not be retried in a loop:
remove the channel and keep polling. The lobby topic `route-tracker` is for staff; a member's join is refused.

### 1.4 Not exposed to the member
The GPS trail points, the lead, the assessor's last name through the ride (first name through the QHP row), the
office's notes, other members' QHPs. `coach_assessment` and `route_tracker` are not readable as tables by a
member except the `route_tracker` row of their own QHP (for the realtime check); use the RPC for everything.

---

## 2. Screens

### 2.1 Home card "Your QHP"
The soonest QHP with `status = scheduled` (skip cancelled; a completed one shows for the rest of that day as
"Done"). Lines: "{Tue, 21 Oct} at {11:00 AM}", "with {assessor_first_name}" (or "assessor to be confirmed"),
the address (two lines max), the state line from section 4, a Call button when `assessor_phone` is present, and
"Set your home location" when `home_pin` is null (goes to 2.3). Tap the card to open 2.2. Refresh every 60 s
while the app is in the foreground, and on foreground return. Hide the card when there is no QHP in 14 days.

### 2.2 QHP screen with the map
Top: the same details. Middle: the map (section 3) in a WebView, 52% of the screen height, minimum 320 pt.
Below the map: three tiles, "Minutes left" (`eta_min`, rounded), "Distance" (`distance_km` with one decimal, "km"),
"Last seen" (from `fix_at`, "just now" under 15 s, then "N s ago", "N min ago"). A status badge (section 4). A
Re-centre button that appears when the page reports `dragged` and sends `follow`. The credit line "Map data from
OpenStreetMap" under the map in small grey text (the page hides the map's own control). Buttons: Call the assessor
(when a phone exists), "Set your home location" / "Update your home location" (2.3).

Polling: `get_my_qhp_tracking` every 10 s while this screen is open and `ride.status` is `on_the_way`, `arrived`
or `stale`; every 60 s otherwise; stop when `ended`. Send `update` to the page after every poll with
`{ assessor: { lat, lng, heading }, ridden: polyline, status }`; send `init` once after the page reports `ready`.

### 2.3 Home pin screen
Three ways to set the pin, all through `set_my_home_location`:
1. **Use my current location**: ask foreground location permission with the copy "Odds Longevity uses your
   location once to save your home address for the assessor's visit." Before saving show "Are you at home right
   now?" with Yes / No; Yes saves with `client_app_gps` and the accuracy; No goes to way 2.
2. **Drop the pin on the map**: the same map page with a draggable pin (send `{ type: 'init', home, editable: true }`;
   the page reports `{ type: 'pin', lat, lng }` on every drag end); Save sends `client_app_pin`.
3. **Paste a Google Maps link**: parse `lat,lng` from `?q=lat,lng`, `@lat,lng`, `/place/.../@lat,lng,` and
   `!3dLAT!4dLNG`; a short `maps.app.goo.gl` link cannot be parsed in the app, so say "Open the link in Google Maps,
   then copy the long link from Share". Save sends `client_app_paste`.
After saving show the pin on the map and "Saved. The assessor will navigate to this spot." If a pin already exists,
show it with "Set on {date}" and the three ways under "Update".

---

## 3. The map page
File: `odds-app/docs/b2c-qhp-tracking-map.html` (copy it into the app as a string constant). MapLibre GL 4.7.1
from jsdelivr with the OpenFreeMap "liberty" style, the same stack as the staff app's navigation. Never CARTO.
It draws: the home pin (green), the planned route (Google blue with a white casing), the ridden trail (grey), the
assessor (orange dot with a pulsing ring and a heading arrow; amber when `stale`, green when `arrived`), and it
follows the assessor until the member drags. The page fetches the style JSON itself and drops the sprite and the
14 POI icon layers: a tracking map does not need shop pins, and the style then loads in about a second with no
image decoding. Verification note: the page's message protocol and drawing code were written from the staff app's
navigation page, which runs on real phones; the desktop browser pane used while writing it cannot run MapLibre's
tile workers, so the first visual check of this file is yours, on a device, as step 3 of section 6.

Messages, app to page (the page listens on both `window` and `document` `message` events):
- `{ type: 'init', home: {lat, lng} | null, address, planned: string | null, ridden: string | null,
   assessor: {lat, lng, heading} | null, status }`
- `{ type: 'update', assessor, ridden, status }`
- `{ type: 'follow' }`

Messages, page to app: `{ type: 'ready' }` (send `init` after it), `{ type: 'dragged' }`, `{ type: 'error', message }`
(show the text fallback: the details and the status line without the map).

React Native WebView wiring:
```tsx
<WebView ref={ref} originWhitelist={['*']} source={{ html: TRACK_MAP_HTML }} javaScriptEnabled domStorageEnabled
  onMessage={(e) => handlePage(JSON.parse(e.nativeEvent.data))} />
// app -> page
ref.current?.injectJavaScript(`window.postMessage(${JSON.stringify(JSON.stringify(msg))}, '*'); true;`);
```
The pin-edit mode (`editable: true`, the `pin` message) is a small addition to the page: a draggable
`maplibregl.Marker({ draggable: true })` on the home position reporting `dragend`. Add it in the same file.

---

## 4. States and copy
| condition | status line | badge |
|---|---|---|
| `status = scheduled`, `ride` null | "We will show the assessor here when they set off" | none |
| `ride.status = on_the_way`, `eta_min` present | "{First name} is on the way, about {N} min away" | "On the way" (orange) |
| `on_the_way`, no `eta_min` | "{First name} is on the way" | "On the way" |
| `ride.status = stale` | "Last seen {N} min ago. The assessor's phone may be locked." | "No signal" (amber) |
| `ride.status = arrived` | "{First name} has arrived" | "Arrived" (green) |
| `ride.status = ended`, `ended_by = arrived` | "Visit done" (keep for the rest of the day) | "Done" |
| `ended`, other reasons | hide the ride; back to the first row | none |
| `status = cancelled` | "This QHP was cancelled. The office will call you to fix a new time." | "Cancelled" |
| `status = completed` | "Done" | "Done" |
| `home_pin` null | add the line "Set your home location so the assessor can find you" | |

"Last seen" uses `fix_at` when present, else `updated_at`, against the phone's clock; if the phone's clock is
behind the server, clamp negative ages to "just now". Clocks and dates in India time: `Tue, 21 Oct`, `11:00 AM`.
First name from `assessor_first_name`, else "The assessor".

---

## 5. Probes (read-only) and checking the migration is live
- As your test member (the member's JWT): `supabase.rpc('get_my_qhp_tracking', { p_days: 60 })` returns `[]` or
  rows; a `PGRST202` means the migration has not been run, stop and tell the owner.
- As the same member: `supabase.rpc('set_my_home_location', { p_lat: 'x', p_lng: 1 })` must fail with code
  `22P02` (the cast fails before any write): that proves the function and its arguments without writing.
- A staff account gets `[]` from `get_my_qhp_tracking` (not a member) and `PIN_NO_MEMBER` from the write.
- Realtime (optional): the member's join to `route:<their assessment_id>` is `SUBSCRIBED` only while a
  `route_tracker` row exists for that QHP (there are none until a ride is published); a join to `route-tracker` is
  refused by design.

---

## 6. Verify on device
1. A test member with a scheduled QHP (the owner schedules one from the staff web app for the test member): the
   home card shows the date, time, assessor and address; Call dials the assessor.
2. Home pin: all three ways save; the card's "Set your home location" line disappears; the staff web app's client
   page shows the pin with method `client_app_...`.
3. The QHP screen: the map renders with the home pin and the address; the status line is the first row of
   section 4; dragging the map shows Re-centre.
4. Live ride (only once the assessor side is switched on): the assessor starts navigation in the staff app; within
   10 s the member's screen shows the orange dot, the blue route and "about N min away"; the dot moves; lock the
   assessor's phone 11 minutes: "No signal"; at the door: "has arrived"; after Exit: "Visit done".

---

## 7. Not in this batch
Push notifications to the member ("your assessor is 10 minutes away"), a public share link for family, and the
assessor's photo. Say so if the owner asks; they are listed in the audit as later work.
