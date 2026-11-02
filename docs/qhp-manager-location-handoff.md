# Handoff: QHP Manager cards, Add / Update client location (2 Nov 2026)

From the web session. **The server is live** (hub-track migration `20261102140000_client_location_rpc.sql`, run 2 Nov 2026, 6/6 checks). The web side is hub-track commit `cd0845a0d`.

## What the owner asked
> "On the QHP Manager page, on the Not Scheduled and Scheduled cards, add a button that shows an input box to add the client's location. It saves the same way and in the same format as the Leads page, so both the QHP Manager page and the Leads page can add the client's location. It helps the assessor navigate."

## What it does
- Every QHP Manager card (Not Scheduled, Scheduled, On Hold) shows whether the client card has a pin:
  - **"Pin saved"** (green); tapping it opens the pin in Google Maps;
  - **"No pin yet"** (amber).
- Next to the card's actions there is an **Add location** button (**Update location** once a pin exists). It opens a sheet where the manager **pastes the location the client shared on WhatsApp**: a Google Maps link, an Apple Maps link, `geo:`, degrees, or `lat, lng`.
- The sheet reads the coordinates as you paste, shows them with an "Open in Google Maps" link, and saves them to the client card.
- The saved pin is `clients.brb_location`, the one **QHP navigation** ("Start navigation" on the assessor's QHP card), the roster distance, the doctor cards and the Essentials auction already read. No other screen needs a change: they pick it up on their next read.

## Server contract (live)
`set_client_brb_location(p_client_id uuid, p_lat double precision, p_lng double precision) → jsonb`

- **Who:** profiles with role `ops`, `crm`, `admin`, `super_admin`, or a QHP manager (`profiles.can_schedule_assessments_for_others = true`, which is what `capabilities.isQhpManager` already reads).
- **Writes:** `clients.brb_location`, replacing any earlier pin, as:
  ```json
  { "lat": 28.530761, "lng": 77.106838, "method": "ops_whatsapp_paste", "accuracy": null,
    "updated_at": "2026-11-02T10:40:00.000Z", "captured_by": "<the signed-in profile id>" }
  ```
  This is the same keys and shape as the web Leads paste and the app's own trainer capture (`useSaveClientHomeLocation`, method `trainer_device_capture`).
- **Returns** the saved object.
- **Refusals** (`CODE: sentence`):
  - `LOCATION_SIGN_IN` (42501);
  - `LOCATION_FORBIDDEN` (42501): "Only ops, CRM, admin or a QHP manager can save a client location.";
  - `LOCATION_INVALID`: out of range, or 0,0;
  - `LOCATION_NOT_FOUND`.
- **Do not** write `clients.brb_location` with a direct update from this screen. A QHP manager is usually a trainer-role profile, and the clients UPDATE policies would silently change nothing for a client they are not assigned to. Always use the RPC.

## Files to build

### 1. `src/lib/sharedLocation.ts`
Copy hub-track `src/lib/sharedLocation.ts` **byte for byte**. It is pure and has no imports. It exports:
- `parseSharedLocation(text) → {lat, lng, source} | null`;
- `isShortMapsLink(text)` (`maps.app.goo.gl` links carry no coordinates);
- `readBrbLocation(v)`;
- `mapsLinkFor(lat, lng)`;
- `formatCoord(n)`;
- `methodLabel(method)`;
- `BRB_METHOD_OPS_PASTE`, `BRB_METHOD_TRAINER_CAPTURE`.

Add a rule test `tests/rules/shared_location_test.js` (the usual `ts.transpileModule` loader). Cases:
- a WhatsApp Google link `https://maps.google.com/?q=28.530761,77.106838`;
- a place link with `!3d28.53!4d77.10`;
- an `@28.53,77.10,17z` link;
- `geo:28.53,77.10`;
- `28.5307° N, 77.1068° E`;
- a plain `28.530761, 77.106838`;
- a short link `https://maps.app.goo.gl/abc`: `parseSharedLocation` returns null and `isShortMapsLink` is true;
- `0, 0` is refused;
- `12, 44` (no decimals) inside a sentence is refused.

### 2. `src/lib/clientLocationQueries.ts` (new)
- `useClientPins(clientIds: string[])`:
  - key `['client-pins', sortedIds]`, staleTime 60 s;
  - `select('id, brb_location').in('id', ids).not('brb_location', 'is', null)` through `withTimeout(…, NET_MS)`;
  - returns `Record<clientId, {lat, lng, method, updated_at}>` via `readBrbLocation`.
  - Keep it separate from `useQhpManager` so the `['qhp-manager','v5']` cache shape does not change.
- `useSetClientPin()`:
  - `rpc('set_client_brb_location', { p_client_id, p_lat, p_lng })` with `withTimeout`.
  - On success, invalidate `['client-pins']`, `['qhp-manager']`, `['qhp-assessments']` (the assessor's QHP cards and Start navigation), and `['client-detail', clientId]` if that key exists.
  - **Errors:** take the sentence after `LOCATION_…:` first, then `friendlyError`. Two refusals carry the 42501 code, which `friendlyError` turns into its generic "not allowed" line. This is the same pattern as `codedSentence` in `src/lib/approvalRequests.ts`; it can be reused if its regex is widened to `(?:OTP|APPROVAL|LOCATION)_`.

### 3. The QHP Manager screen (`src/screens/trainer.tsx`, `export function QhpManager`, tabs Not Scheduled / Scheduled / On Hold around the `notsched` / `sched` / `hold` tab ids)
- Call `useClientPins` with the client ids of `taskNotScheduled`, `taskScheduled` and `taskOnHold`.
- **On each card:**
  - **Pin chip:** `Pin saved` (green, `Linking.openURL(mapsLinkFor(lat, lng))`) or `No pin yet` (amber).
  - **Button:** `Add location` / `Update location` in the card's action row, after Schedule / Hold / Cancel or Reschedule / Cancel. Use `hitSlop` 10 or more and an `accessibilityLabel` like "Add location for <name>".
- **The sheet** (`ClientLocationSheet`). Follow the standing sheet rules: `useKeyboardHeight`, a sibling backdrop, `keyboardShouldPersistTaps="handled"`, and never sibling modals.
  1. **Title:** "Add location for <name>".
  2. **Existing pin:** when the client already has one, an amber line: "Already has a pin (<methodLabel>, <date>). Saving replaces it." with a View link.
  3. **Paste box:** a multiline `TextInput` labelled "Location shared on WhatsApp", placeholder "Paste the location message or Google Maps link".
  4. **Live result:**
     - **Parsed:** a green box with "Lat 28.530761 · Lng 77.106838", "Read from <source>" and an "Open in Google Maps" link.
     - **Short link:** "This is a shortened Google Maps link and does not contain the coordinates. Open it in a browser and paste the full link from the address bar, or paste the coordinates."
     - **Unreadable:** "Could not find coordinates in this text. Paste the Google Maps link from the WhatsApp location message, or the coordinates like 28.530761, 77.106838."
     - **Empty:** "In WhatsApp, open the shared location, copy the message or the Google Maps link, and paste it here."
  5. **Buttons:** Cancel and **Save location**. Save is enabled only when the text parsed; it shows "Saving…" while busy, then shows the toast "Location saved: <lat>, <lng>" and closes.
- **Paste from clipboard (optional):** a "Paste" chip that fills the box from `expo-clipboard`, which is already a dependency.
- **Offline:** this is a manager action. Show the plain no-connection line and do not queue it.
- **Copy rules:** no em dashes; wording as above (it matches the web).

## Not changing
- The assessor's own capture on the QHP card (`useSaveClientHomeLocation`, only while the pin is empty) stays as it is.
- The QHP navigation screen already flags pins pasted by ops (method `ops_whatsapp_paste`) as "check with the client". Pins pasted from the QHP Manager page carry the same method on purpose ("same format as the Leads page").

## Test
1. `node tests/rules/shared_location_test.js` gives ALL PASS. Then `npx tsc --noEmit`, then the bundle check. Build an APK only on request.
2. **Device:**
   - **As a QHP manager:** open QHP Manager. A card shows "No pin yet". Add location, paste `https://maps.google.com/?q=28.530761,77.106838`, and save. The chip turns "Pin saved" and opens Google Maps at that point.
   - **As the assigned assessor:** the QHP card offers Start navigation to that pin.
   - **As a trainer without QHP-manager rights:** the page is hidden. If the RPC is called anyway, the sheet shows "Only ops, CRM, admin or a QHP manager can save a client location."

## Feature docs to update
- `docs/features/android/...` QHP Manager file (or the trainer dashboard file that covers it): a UI line and a change log.
- The web files are already updated: `web/ops/leads.md`, `web/trainer/trainer-dashboard.md`.
