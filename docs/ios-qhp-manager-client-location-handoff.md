# iOS handoff: QHP Manager cards, Add / Update client location (Android, 2 Nov 2026)

Owner: "On the QHP Manager page, on the Not Scheduled and Scheduled cards, add a button that shows an input box to add
the client's location. It saves the same way and in the same format as the Leads page, so both the QHP Manager page
and the Leads page can add the client's location. It helps the assessor navigate." Built on Android on 2 Nov 2026.
Server: live (hub-track migration `20261102140000_client_location_rpc.sql`, 6 of 6 checks). Web side: hub-track
commit `cd0845a0d`. Feature doc: `b2b/docs/features/android/trainer/qhp-manager-client-location.md`.
Copy rule: no dashes in user-facing text. In the code below a literal em dash inside an existing Android comment is
written as `\u2014`; it is only in comments, nothing the user reads.

## 1. What the user sees (Android)
- Every QHP Manager > Task Pending card (Not Scheduled, Scheduled, On Hold) gets one more row under its action
  buttons:
  - left, a chip: **Pin saved** (green; tapping it opens the pin in Google Maps) or **No pin yet** (amber, not
    tappable);
  - right, only while the client has no pin, a button **Add location** that opens the sheet. A saved pin shows the
    chip alone (owner, 2 Nov 2026: the option only when the value is null); a pin is changed from the Leads page.
- The sheet (`ClientLocationSheet`):
  1. Title "Add location for <name>", line under it "The pin the assessor navigates to. Saved to the client card,
     like the Leads page."
  2. The sheet can show an amber line "Already has a pin (<method label>, <d Mon yyyy>). Saving replaces it." with a
     **View** link; from this page it never does, because the button only opens for a client with no pin. Keep the
     code: it is the same sheet as the web dialog and costs nothing.
  3. The box, labelled LOCATION SHARED ON WHATSAPP, with a **Paste** chip (reads the clipboard) and the placeholder
     "Paste the location message or Google Maps link". Multiline, no autocorrect.
  4. The live result as the text changes:
     - parsed: a green box "Lat 28.530761 · Lng 77.106838", "Read from Google Maps link" (or Apple Maps link, geo
       link, degree notation, coordinates) and an **Open in Google Maps** link;
     - a shortened link: "This is a shortened Google Maps link and does not contain the coordinates. Open it in a
       browser and paste the full link from the address bar, or paste the coordinates.";
     - unreadable: "Could not find coordinates in this text. Paste the Google Maps link from the WhatsApp location
       message, or the coordinates like 28.530761, 77.106838.";
     - empty: "In WhatsApp, open the shared location, copy the message or the Google Maps link, and paste it here."
  5. Offline: "No connection. The location can only be saved online." and Save stays off (a manager action; never
     queued).
  6. Buttons **Cancel** and **Save location** ("Saving…" while busy; enabled only when the text parsed). After the
     save: the sheet closes, an alert "Location saved" shows the coordinates, the chip turns "Pin saved".
  7. A refusal shows the server's own sentence in red, e.g. "Only ops, CRM, admin or a QHP manager can save a client
     location."

## 2. Data / server contract
- RPC `set_client_brb_location(p_client_id uuid, p_lat double precision, p_lng double precision) → jsonb`: returns
  the saved object. Who: role ops, crm, admin, super_admin, or a QHP manager (`profiles.can_schedule_assessments_for_others
  = true`, what `capabilities.isQhpManager` already reads).
- It writes `clients.brb_location`, replacing any earlier pin:
  `{ "lat": 28.530761, "lng": 77.106838, "method": "ops_whatsapp_paste", "accuracy": null, "updated_at": "<iso>",
  "captured_by": "<the signed-in profile id>" }`. Same keys and shape as the web Leads paste and the app's trainer
  capture (`useSaveClientHomeLocation`, method `trainer_device_capture`). QHP navigation ("Start navigation" on the
  assessor's QHP card), the roster distance, the doctor cards and the Essentials auction read it: no other screen
  changes.
- Refusals (`CODE: sentence`): `LOCATION_SIGN_IN` (42501); `LOCATION_FORBIDDEN` (42501) "Only ops, CRM, admin or a
  QHP manager can save a client location."; `LOCATION_INVALID` (out of range, or 0,0); `LOCATION_NOT_FOUND`. The
  two 42501 ones would read as friendlyError's generic "not allowed" line, so the app shows `codedSentence(e)` first.
- Never a direct update of `clients.brb_location` from this screen: a QHP manager is usually a trainer-role profile
  and the clients UPDATE policies would silently change nothing for a client they are not assigned to.
- Reading the pins: `clients(id, brb_location)` for the cards' client ids. QHP managers may read every client
  (policy "QHP managers can view all clients", migration `20261012110000`).
- Cache: `['client-pins', sortedIds]` (staleTime 60 s, batches of 150 ids). A save invalidates `['client-pins']`,
  `['qhp-manager']`, `['qhp-assessments']` and `['client-detail', clientId]`. `useQhpManager` and its
  `['qhp-manager', 'v5']` shape are untouched.

## 3. Code to port

### 3.1 `src/lib/sharedLocation.ts` (new, pure, copy byte for byte; it is the web's file)
```ts
// Pure helpers for the "Add client location" paste on the ops Leads page
// (2026-10-06). An ops user pastes the location a client shared on WhatsApp
// (WhatsApp renders a shared pin as a Google Maps link such as
// https://maps.google.com/?q=28.530761,77.106838) and we read the coordinates
// out of whatever text arrived: Google / Apple Maps links, geo: URIs, degree
// notation or a plain "lat, lng" pair. No network, no DOM; node-tested.
//
// The saved shape MUST stay identical to the trainer capture written by the
// Android app (odds-app clientQueries.ts useSaveClientHomeLocation), because
// the doctor cards, the roster ETA and the Essentials auction read
// clients.brb_location.lat / .lng as numbers:
//   { lat, lng, method, accuracy, updated_at, captured_by }

export type SharedLocationSource =
  | "google_maps_link"
  | "apple_maps_link"
  | "geo_uri"
  | "degrees"
  | "coordinates";

export interface ParsedSharedLocation {
  lat: number;
  lng: number;
  source: SharedLocationSource;
}

export interface BrbLocation {
  lat: number;
  lng: number;
  method: string;
  accuracy: number | null;
  updated_at: string;
  captured_by: string | null;
}

/** Method stamp for a location pasted by ops from a WhatsApp share. */
export const BRB_METHOD_OPS_PASTE = "ops_whatsapp_paste";
/** Method stamp the Android trainer capture writes (read-only here, for labels). */
export const BRB_METHOD_TRAINER_CAPTURE = "trainer_device_capture";

const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";
const SEP = "\\s*,\\s*";
const PAIR = new RegExp(`${NUM}${SEP}${NUM}`);
// A plain pair must carry decimals on both sides so "12, 44" in a sentence is
// not mistaken for a pin. Link forms below do not need this.
const DECIMAL_PAIR = /(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/;
const DEGREES =
  /(\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])\b[\s,]*(\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])\b/i;

const SHORT_LINK = /(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|g\.page)\//i;

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/** True for shortened Google Maps links, which carry no coordinates in the text. */
export function isShortMapsLink(text: string): boolean {
  return SHORT_LINK.test(text ?? "");
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

function pairFrom(m: RegExpMatchArray | null, latIdx = 1, lngIdx = 2): { lat: number; lng: number } | null {
  if (!m) return null;
  const lat = Number(m[latIdx]);
  const lng = Number(m[lngIdx]);
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

/**
 * Read a latitude / longitude out of pasted text. Returns null when nothing
 * usable is found (callers can check isShortMapsLink to explain why).
 */
export function parseSharedLocation(raw: string | null | undefined): ParsedSharedLocation | null {
  if (!raw) return null;
  const text = safeDecode(String(raw).trim());
  if (!text) return null;

  const isGoogle = /google\.[a-z.]+\/maps|maps\.google\.|goo\.gl/i.test(text);
  const isApple = /maps\.apple\.com/i.test(text);

  // Google place links carry the pin as !3d<lat>!4d<lng>.
  const data = pairFrom(text.match(new RegExp(`!3d${NUM}!4d${NUM}`)));
  if (data) return { ...data, source: "google_maps_link" };

  // Named query params used by Google and Apple Maps links.
  const param = pairFrom(
    text.match(
      new RegExp(`(?:[?&#]|^)(?:q|query|ll|sll|center|destination|daddr|saddr|origin|viewpoint)=(?:loc:)?${NUM}${SEP}${NUM}`, "i"),
    ),
  );
  if (param) return { ...param, source: isApple ? "apple_maps_link" : "google_maps_link" };

  // Google "/@lat,lng,17z" viewport form.
  const at = pairFrom(text.match(new RegExp(`@${NUM}${SEP}${NUM}`)));
  if (at) return { ...at, source: "google_maps_link" };

  // geo:lat,lng URIs (Android shares).
  const geo = pairFrom(text.match(new RegExp(`geo:${NUM}${SEP}${NUM}`, "i")));
  if (geo) return { ...geo, source: "geo_uri" };

  // 28.5307° N, 77.1068° E
  const deg = text.match(DEGREES);
  if (deg) {
    const lat = Number(deg[1]) * (deg[2].toUpperCase() === "S" ? -1 : 1);
    const lng = Number(deg[3]) * (deg[4].toUpperCase() === "W" ? -1 : 1);
    if (isValidLatLng(lat, lng)) return { lat, lng, source: "degrees" };
  }

  // Bare "lat, lng" with decimals, anywhere in the message.
  const plain = pairFrom(text.match(DECIMAL_PAIR));
  if (plain) return { ...plain, source: isGoogle ? "google_maps_link" : "coordinates" };

  // Last resort inside a maps link only: any numeric pair.
  if (isGoogle || isApple) {
    const any = pairFrom(text.match(PAIR));
    if (any) return { ...any, source: isApple ? "apple_maps_link" : "google_maps_link" };
  }
  return null;
}

/** Build the exact clients.brb_location payload for an ops paste. */
export function buildBrbLocation(
  lat: number,
  lng: number,
  capturedBy: string | null,
  now: Date = new Date(),
  method: string = BRB_METHOD_OPS_PASTE,
): BrbLocation {
  return {
    lat,
    lng,
    method,
    accuracy: null,
    updated_at: now.toISOString(),
    captured_by: capturedBy,
  };
}

/** Tolerant reader for whatever is stored today (trainer capture or paste). */
export function readBrbLocation(v: unknown): BrbLocation | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  if (!isValidLatLng(lat, lng)) return null;
  const acc = o.accuracy == null ? null : Number(o.accuracy);
  return {
    lat,
    lng,
    method: typeof o.method === "string" ? o.method : "unknown",
    accuracy: acc != null && Number.isFinite(acc) ? acc : null,
    updated_at: typeof o.updated_at === "string" ? o.updated_at : "",
    captured_by: typeof o.captured_by === "string" ? o.captured_by : null,
  };
}

export function mapsLinkFor(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function formatCoord(n: number): string {
  return Number.isFinite(n) ? n.toFixed(6) : "";
}

export function methodLabel(method: string | null | undefined): string {
  switch (method) {
    case BRB_METHOD_OPS_PASTE:
      return "WhatsApp paste (Ops)";
    case BRB_METHOD_TRAINER_CAPTURE:
      return "Trainer device capture";
    default:
      return method ? method.replace(/_/g, " ") : "unknown source";
  }
}
```

### 3.2 `tests/rules/shared_location_test.js` (new, 21 checks; portable ROOT)
```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/shared_location_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/sharedLocation.ts (copied byte for byte from the web, 2 Nov 2026): reading a client's pin
// out of the text they shared on WhatsApp, and the helpers the QHP Manager cards use.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/sharedLocation.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const L = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// 1. the forms WhatsApp and the maps apps produce
eq('WhatsApp Google link', L.parseSharedLocation('https://maps.google.com/?q=28.530761,77.106838'), { lat: 28.530761, lng: 77.106838, source: 'google_maps_link' });
eq('place link with !3d !4d', L.parseSharedLocation('https://www.google.com/maps/place/Odds/@28.5,77.1,17z/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d28.53!4d77.10'), { lat: 28.53, lng: 77.1, source: 'google_maps_link' });
eq('@lat,lng,zoom link', L.parseSharedLocation('https://www.google.com/maps/@28.53,77.10,17z'), { lat: 28.53, lng: 77.1, source: 'google_maps_link' });
eq('geo uri', L.parseSharedLocation('geo:28.53,77.10'), { lat: 28.53, lng: 77.1, source: 'geo_uri' });
eq('degrees', L.parseSharedLocation('28.5307° N, 77.1068° E'), { lat: 28.5307, lng: 77.1068, source: 'degrees' });
eq('plain pair', L.parseSharedLocation('28.530761, 77.106838'), { lat: 28.530761, lng: 77.106838, source: 'coordinates' });
eq('pair inside a message', L.parseSharedLocation('My location: 28.530761, 77.106838 see you there'), { lat: 28.530761, lng: 77.106838, source: 'coordinates' });
eq('apple maps link', L.parseSharedLocation('https://maps.apple.com/?ll=28.530761,77.106838&q=Home'), { lat: 28.530761, lng: 77.106838, source: 'apple_maps_link' });

// 2. what is refused
eq('short link: no coordinates', L.parseSharedLocation('https://maps.app.goo.gl/abc'), null);
eq('short link: flagged', [L.isShortMapsLink('https://maps.app.goo.gl/abc'), L.isShortMapsLink('https://maps.google.com/?q=28.5,77.1')], [true, false]);
eq('0,0 refused', L.parseSharedLocation('0, 0'), null);
eq('whole numbers in a sentence refused', L.parseSharedLocation('I have 12, 44 sessions left'), null);
eq('empty and null', [L.parseSharedLocation(''), L.parseSharedLocation(null), L.parseSharedLocation(undefined)], [null, null, null]);
eq('out of range refused', L.parseSharedLocation('128.5, 77.1'), null);

// 3. helpers the cards and the sheet use
eq('read stored pin', L.readBrbLocation({ lat: '28.530761', lng: 77.106838, method: 'ops_whatsapp_paste', accuracy: null, updated_at: '2026-11-02T10:40:00.000Z', captured_by: 'abc' }),
  { lat: 28.530761, lng: 77.106838, method: 'ops_whatsapp_paste', accuracy: null, updated_at: '2026-11-02T10:40:00.000Z', captured_by: 'abc' });
eq('read bad pin', [L.readBrbLocation(null), L.readBrbLocation({ lat: 0, lng: 0 }), L.readBrbLocation('x')], [null, null, null]);
eq('maps link', L.mapsLinkFor(28.530761, 77.106838), 'https://www.google.com/maps?q=28.530761,77.106838');
eq('format coord', [L.formatCoord(28.5), L.formatCoord(NaN)], ['28.500000', '']);
eq('method labels', [L.methodLabel('ops_whatsapp_paste'), L.methodLabel('trainer_device_capture'), L.methodLabel('something_else'), L.methodLabel(null)], ['WhatsApp paste (Ops)', 'Trainer device capture', 'something else', 'unknown source']);
eq('method stamps', [L.BRB_METHOD_OPS_PASTE, L.BRB_METHOD_TRAINER_CAPTURE], ['ops_whatsapp_paste', 'trainer_device_capture']);
eq('saved shape', Object.keys(L.buildBrbLocation(28.5, 77.1, 'u1', new Date('2026-11-02T10:40:00.000Z'))), ['lat', 'lng', 'method', 'accuracy', 'updated_at', 'captured_by']);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
```

### 3.3 `src/lib/approvalRequests.ts`: `codedSentence` also reads `LOCATION_` (and one test line)
Android diff (apply the same two changes):
```diff
@@ -107,14 +107,15 @@ export const sessionCodeStatusLine = (r: ApprovalRequest | null | undefined): {
       return null;
   }
 };
 
-/** The plain sentence of an approval / Session code server error ("APPROVAL_OWN_REQUEST: You cannot review your
-    own request."). Some of them carry the 42501 "not allowed" code, which friendlyError turns into its generic
-    line; these screens show the server's own sentence first and fall back to friendlyError otherwise. */
+/** The plain sentence of an approval / Session code / client location server error ("APPROVAL_OWN_REQUEST: You
+    cannot review your own request."). Some of them carry the 42501 "not allowed" code, which friendlyError turns
+    into its generic line; these screens show the server's own sentence first and fall back to friendlyError
+    otherwise. LOCATION_ added 2 Nov 2026 (set_client_brb_location). */
 export const codedSentence = (e: unknown): string | null => {
   const msg = String((e as { message?: unknown } | null)?.message ?? '').trim();
-  const m = msg.match(/^(?:OTP|APPROVAL)_[A-Z_]+:\s*(.+)$/s);
+  const m = msg.match(/^(?:OTP|APPROVAL|LOCATION)_[A-Z_]+:\s*(.+)$/s);
   return m && m[1].trim() ? m[1].trim() : null;
 };
 
 /** Reason / note checks the server also makes (so the button can say why it is not ready). */

@@ -73,8 +73,9 @@ eq('needs approval (42501)', shown(E("OTP_OFF_NEEDS_APPROVAL: Turning off the Se
 eq('own request (42501)', shown(E('APPROVAL_OWN_REQUEST: You cannot review your own request.', '42501')), 'You cannot review your own request.');
 eq('pending', shown(E('APPROVAL_PENDING: A request for this is already waiting for approval.', 'P0001')), 'A request for this is already waiting for approval.');
 eq('reject note', shown(E('APPROVAL_NOTE: Write why it is rejected (at least 5 characters).', 'P0001')), 'Write why it is rejected (at least 5 characters).');
 eq('already decided', shown(E('APPROVAL_DONE: This request is already approved. Refresh the page.', 'P0001')), 'This request is already approved. Refresh the page.');
+eq('client location refusal (42501, 2 Nov 2026)', shown(E('LOCATION_FORBIDDEN: Only ops, CRM, admin or a QHP manager can save a client location.', '42501')), 'Only ops, CRM, admin or a QHP manager can save a client location.');
 eq('other errors still friendly', shown(E('Failed to fetch')), FE.NO_CONNECTION);
 eq('a plain 42501 still generic', shown(E('new row violates row-level security policy for table "x"', '42501')), FE.NOT_ALLOWED);
 
 console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
```
If the iOS repo does not have `approvalRequests.ts` yet (the approval requests handoff of 2 Nov 2026), put this
helper in `clientLocationQueries.ts` instead:
```ts
export const codedSentence = (e: unknown): string | null => {
  const msg = String((e as { message?: unknown } | null)?.message ?? '').trim();
  const m = msg.match(/^(?:OTP|APPROVAL|LOCATION)_[A-Z_]+:\s*(.+)$/s);
  return m && m[1].trim() ? m[1].trim() : null;
};
```

### 3.4 `src/lib/clientLocationQueries.ts` (new)
```ts
/* Client location pins for the QHP Manager cards (2 Nov 2026, owner: "on the Not Scheduled and Scheduled cards, a
   button with an input box to add the client's location, saved the same way and in the same format as the Leads
   page, so the assessor can navigate"). Server: hub-track migration 20261102140000_client_location_rpc.sql (live).
   The pin is clients.brb_location, the one QHP navigation, the roster distance, the doctor cards and the
   Essentials auction already read. Plain-object query data (persisted cache). Rules in ./sharedLocation.ts. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { friendlyError } from './friendlyError';
import { codedSentence } from './approvalRequests';
import { readBrbLocation } from './sharedLocation';

export type ClientPin = { lat: number; lng: number; method: string; updated_at: string };

/** The saved pins of these clients (QHP managers may read every client: policy of 20261012110000). Clients
    without a pin are simply absent. Kept apart from useQhpManager so its ['qhp-manager', 'v5'] cache shape stays. */
export function useClientPins(clientIds: (string | null | undefined)[], enabled = true) {
  const ids = [...new Set(clientIds.filter((x): x is string => !!x))].sort();
  return useQuery({
    queryKey: ['client-pins', ids],
    enabled: enabled && ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, ClientPin>> => {
      const out: Record<string, ClientPin> = {};
      for (let i = 0; i < ids.length; i += 150) {   // the id list travels in the URL: batches keep it short
        const chunk = ids.slice(i, i + 150);
        const { data, error } = await withTimeout(
          Promise.resolve(supabase.from('clients').select('id, brb_location').in('id', chunk).not('brb_location', 'is', null)) as Promise<{ data: any; error: any }>,
          NET_MS, 'Client pins');
        if (error) throw new Error(error.message);
        for (const r of (data ?? []) as any[]) {
          const b = readBrbLocation(r.brb_location);
          if (b) out[r.id] = { lat: b.lat, lng: b.lng, method: b.method, updated_at: b.updated_at };
        }
      }
      return out;
    },
  });
}

/** The server's plain sentence for a refused save ("LOCATION_FORBIDDEN: Only ops, CRM, admin or a QHP manager can
    save a client location."): two refusals carry the 42501 code, which friendlyError would turn into its generic
    "not allowed" line, so the server's words come first. */
export const locationErrorText = (e: unknown): string => codedSentence(e) ?? friendlyError(e, 'Could not save the location. Try again.');

/** Saves the pin through the RPC. Never a direct update of clients.brb_location: a QHP manager is usually a
    trainer-role profile, and the clients UPDATE policies would silently change nothing for a client they are not
    assigned to. */
export function useSetClientPin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, lat, lng }: { clientId: string; lat: number; lng: number }): Promise<ClientPin> => {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('set_client_brb_location', { p_client_id: clientId, p_lat: lat, p_lng: lng })) as Promise<{ data: any; error: any }>,
        NET_MS, 'Save location');
      if (error) throw error;
      const b = readBrbLocation(data);
      return b ? { lat: b.lat, lng: b.lng, method: b.method, updated_at: b.updated_at } : { lat, lng, method: 'ops_whatsapp_paste', updated_at: new Date().toISOString() };
    },
    onSuccess: (_pin, v) => {
      qc.invalidateQueries({ queryKey: ['client-pins'] });
      qc.invalidateQueries({ queryKey: ['qhp-manager'] });
      qc.invalidateQueries({ queryKey: ['qhp-assessments'] });   // the assessor's QHP cards and Start navigation
      qc.invalidateQueries({ queryKey: ['client-detail', v.clientId] });
    },
  });
}
```

### 3.5 `src/components/ClientLocationSheet.tsx` (new)
Uses the app's `C`, `F`, `hexA` theme, `Icon` (names `pin`, `map`, `clipboard`, `alert`, `close`), `Body` /
`Serif` / `Mono` primitives, `useKeyboardHeight`, `useIsOnline` and `expo-clipboard`, all of which the iOS repo
already has from earlier ports. Sheet rules: sibling backdrop, keyboard padding, `keyboardShouldPersistTaps`,
`hitSlop` 10, one Modal at a time.
```tsx
import React from 'react';
import { View, Text, Pressable, Modal, TextInput, ScrollView, ActivityIndicator, Keyboard, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Serif, Mono } from './primitives';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { useIsOnline } from '../lib/offline';
import { useSetClientPin, locationErrorText, type ClientPin } from '../lib/clientLocationQueries';
import { parseSharedLocation, isShortMapsLink, mapsLinkFor, formatCoord, methodLabel } from '../lib/sharedLocation';

/* Add / Update client location (2 Nov 2026): the QHP manager pastes the location the client shared on WhatsApp (a
   Google Maps link, an Apple Maps link, geo:, degrees, or "lat, lng"); the sheet reads the coordinates as they
   paste and saves them to the client card through set_client_brb_location. Same words as the web Leads dialog.
   Sheet rules: sibling backdrop, keyboard padding, keyboardShouldPersistTaps, hitSlop >= 10, one Modal at a time
   (the caller mounts it next to its other sheets and opens it alone). */
export type LocationTarget = { clientId: string; name: string } | null;

const SOURCE_LABEL: Record<string, string> = {
  google_maps_link: 'Google Maps link',
  apple_maps_link: 'Apple Maps link',
  geo_uri: 'geo link',
  degrees: 'degree notation',
  coordinates: 'coordinates',
};
const EMPTY_HINT = 'In WhatsApp, open the shared location, copy the message or the Google Maps link, and paste it here.';
const SHORT_LINK_HINT = 'This is a shortened Google Maps link and does not contain the coordinates. Open it in a browser and paste the full link from the address bar, or paste the coordinates.';
const UNREADABLE_HINT = 'Could not find coordinates in this text. Paste the Google Maps link from the WhatsApp location message, or the coordinates like 28.530761, 77.106838.';
const OFFLINE_LINE = 'No connection. The location can only be saved online.';

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
};

export function ClientLocationSheet({ target, existing, onClose }: { target: LocationTarget; existing: ClientPin | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const online = useIsOnline();
  const saveM = useSetClientPin();
  const [text, setText] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const visible = !!target;
  const busy = saveM.isPending;

  React.useEffect(() => {
    if (visible) { setText(''); setErr(null); saveM.reset(); } else Keyboard.dismiss();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseSharedLocation(text);
  const trimmed = text.trim();
  const shortLink = !parsed && !!trimmed && isShortMapsLink(trimmed);
  const unreadable = !parsed && !!trimmed && !shortLink;
  const canSave = !!parsed && !!target && online && !busy;

  const paste = async () => {
    try { const t = await Clipboard.getStringAsync(); if (t) { setText(t); setErr(null); } } catch { /* nothing on the clipboard */ }
  };
  const save = async () => {
    if (!parsed || !target) return;
    setErr(null);
    try {
      const pin = await saveM.mutateAsync({ clientId: target.clientId, lat: parsed.lat, lng: parsed.lng });
      Keyboard.dismiss();
      onClose();
      Alert.alert('Location saved', `${formatCoord(pin.lat)}, ${formatCoord(pin.lng)}`);
    } catch (e) {
      setErr(locationErrorText(e));
    }
  };
  const close = () => { if (!busy) onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)' }} />
        <View accessibilityViewIsModal style={{ maxHeight: '88%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: insets.bottom + 18 + kbH }}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 13 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="pin" size={18} color={C.green} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>Add location for {target?.name ?? ''}</Serif>
                <Body style={{ fontSize: 12, color: C.muted2, marginTop: 3, lineHeight: 17 }}>The pin the assessor navigates to. Saved to the client card, like the Leads page.</Body>
              </View>
              <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>

            {existing ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 11, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
                <View style={{ marginTop: 1 }}><Icon name="alert" size={13} color={C.gold} strokeWidth={2.2} /></View>
                <Body style={{ flex: 1, fontSize: 11.5, color: C.gold, lineHeight: 16 }}>
                  Already has a pin ({methodLabel(existing.method)}{existing.updated_at ? `, ${fmtDay(existing.updated_at)}` : ''}). Saving replaces it.{' '}
                  <Text onPress={() => Linking.openURL(mapsLinkFor(existing.lat, existing.lng)).catch(() => {})} style={{ fontFamily: F.bodyBold, textDecorationLine: 'underline' }}>View</Text>
                </Body>
              </View>
            ) : null}

            <View style={{ gap: 7 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Mono style={{ flex: 1, fontSize: 9.5, letterSpacing: 1.1, color: C.mono2 }}>LOCATION SHARED ON WHATSAPP</Mono>
                <Pressable onPress={paste} hitSlop={10} accessibilityRole="button" accessibilityLabel="Paste from the clipboard" style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                  <Icon name="clipboard" size={11} color={C.ink3} strokeWidth={2.1} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.ink3 }}>Paste</Text>
                </Pressable>
              </View>
              <TextInput
                value={text}
                onChangeText={(t) => { setText(t); if (err) setErr(null); }}
                multiline
                autoCorrect={false}
                autoCapitalize="none"
                keyboardType="default"
                editable={!busy}
                accessibilityLabel="Location shared on WhatsApp"
                placeholder="Paste the location message or Google Maps link"
                placeholderTextColor={C.muted3}
                style={{ minHeight: 84, textAlignVertical: 'top', paddingVertical: 12, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: parsed ? hexA(C.green, 0.45) : unreadable ? hexA(C.red, 0.45) : 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 14 }}
              />
            </View>

            {parsed ? (
              <View style={{ padding: 11, borderRadius: 12, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.3), gap: 4 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 13.5, color: '#fff' }}>Lat {formatCoord(parsed.lat)} · Lng {formatCoord(parsed.lng)}</Text>
                <Body style={{ fontSize: 11, color: C.muted2 }}>Read from {SOURCE_LABEL[parsed.source] ?? parsed.source}</Body>
                <Pressable onPress={() => Linking.openURL(mapsLinkFor(parsed.lat, parsed.lng)).catch(() => {})} hitSlop={10} accessibilityRole="link" style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.green, textDecorationLine: 'underline' }}>Open in Google Maps</Text>
                </Pressable>
              </View>
            ) : shortLink ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <View style={{ marginTop: 1 }}><Icon name="alert" size={13} color={C.gold} strokeWidth={2.2} /></View>
                <Body style={{ flex: 1, fontSize: 11.5, color: C.gold, lineHeight: 16 }}>{SHORT_LINK_HINT}</Body>
              </View>
            ) : unreadable ? (
              <Body style={{ fontSize: 11.5, color: C.red, lineHeight: 16 }}>{UNREADABLE_HINT}</Body>
            ) : (
              <Body style={{ fontSize: 11.5, color: C.muted2, lineHeight: 16 }}>{EMPTY_HINT}</Body>
            )}

            {!online ? <Body style={{ fontSize: 12, color: C.gold, textAlign: 'center' }}>{OFFLINE_LINE}</Body> : null}
            {err ? <Body style={{ fontSize: 12, color: C.red, textAlign: 'center' }}>{err}</Body> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
              <Pressable onPress={close} disabled={busy} hitSlop={10} accessibilityRole="button" style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={save} disabled={!canSave} hitSlop={10} accessibilityRole="button" accessibilityState={{ disabled: !canSave }} style={{ flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(C.green, canSave ? 0.18 : 0.08), borderWidth: 1, borderColor: hexA(C.green, canSave ? 0.5 : 0.2), opacity: canSave ? 1 : 0.55 }}>
                {busy ? <ActivityIndicator size="small" color={C.green} /> : <Icon name="pin" size={14} color={C.green} strokeWidth={2.3} />}
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.green }}>{busy ? 'Saving…' : 'Save location'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
```

### 3.6 `src/screens/trainer.tsx`, `export function QhpManager`
Five additions, shown as the Android diff with 4 lines of context so each one can be placed: (a) three imports next to
`useKeyboardHeight`; (b) the pins read and the sheet target, right after `const [tab, setTab]` (hooks: they must sit
before the early returns); (c) `pinRow`, a plain function after `fmtT`; (d) `{pinRow(c)}` once at the end of each
of the three Task Pending card kinds (after the Not Scheduled action row, after the Scheduled action row, after the
On Hold Schedule button); (e) the sheet mounted next to the other QHP Manager sheets.
```diff
@@ -55,8 +55,11 @@ import { SessionOtpSheet } from '../components/SessionOtpSheet';
 import { ClientThreadsCard } from '../components/clientThreadsCard';
 import { ManagerTeamChatCard } from './managerChat';
 import { istToday, useMyManagerTeam, TRAINER_MODALITIES } from '../lib/managerChatQueries';
 import { useKeyboardHeight } from '../lib/useKeyboardHeight';
+import { ClientLocationSheet, type LocationTarget } from '../components/ClientLocationSheet';
+import { useClientPins } from '../lib/clientLocationQueries';
+import { mapsLinkFor } from '../lib/sharedLocation';
 import { localToday, fetchScheduledSleepHours, useMedicineSuggestions } from '../lib/clientQueries';
 import { buildCheckinItems, initialTicked, isDuplicateName, nameKey, sourceLabel, lastCheckinLine, type MedicineCheckinPayload } from '../lib/medicineCheckin';
 import { startTimer, finishTimer, clearTimer, readTimer, SessionTiming, type TimerStart } from '../lib/sessionTiming';
 import { SessionClock } from '../components/SessionClock';
@@ -10686,8 +10689,14 @@ export function QhpManager() {
   const deleteQhpM = useDeleteQhp();
   const { session } = useAuth();
   const { set, go } = useStore();
   const [tab, setTab] = React.useState<'task' | 'manager' | 'tracker' | 'requests' | 'linked' | 'review' | 'cancellations'>('task');
+  // Client location (2 Nov 2026): the pin chip on every Task Pending card and the Add location sheet. The
+  // saved pin is clients.brb_location, the one QHP navigation and the roster distance read.
+  const pinIds = React.useMemo(() => [...(q.data?.taskNotScheduled ?? []), ...(q.data?.taskScheduled ?? []), ...(q.data?.taskOnHold ?? [])].map((c) => c.clientId), [q.data]);
+  const pinsQ = useClientPins(pinIds, isMgr);
+  const pins = pinsQ.data ?? {};
+  const [locFor, setLocFor] = React.useState<LocationTarget>(null);
   // Cancellation requests (26 Oct 2026): Pending and Decided lists, the decide sheet, the push-tap focus.
   const [cancelSeg, setCancelSeg] = React.useState<'pending' | 'decided'>('pending');
   const [decideFor, setDecideFor] = React.useState<DecideTarget>(null);
   const cancelPendingQ = useQhpCancellationRequests('pending', isMgr);
@@ -10819,8 +10828,31 @@ export function QhpManager() {
   };
 
   const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014');
   const fmtT = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase() : '');
+  // The pin line under a Task Pending card's actions: "Pin saved" (opens Google Maps), or "No pin yet" with the
+  // Add location button that opens the paste sheet. The button shows only while the client card has no pin
+  // (owner, 2 Nov 2026); a saved pin is changed from the Leads page.
+  const pinRow = (c: import('../lib/qhpManagerQueries').PendingClient) => {
+    const pin = pins[c.clientId];
+    return (
+      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
+        <Pressable onPress={() => { if (pin) Linking.openURL(mapsLinkFor(pin.lat, pin.lng)).catch(() => {}); }} disabled={!pin} hitSlop={10} accessibilityRole={pin ? 'link' : 'text'} accessibilityLabel={pin ? `Pin saved for ${c.name}, open in Google Maps` : `No pin yet for ${c.name}`}
+          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: hexA(pin ? C.green : C.gold, 0.1), borderWidth: 1, borderColor: hexA(pin ? C.green : C.gold, 0.35) }}>
+          <Icon name="pin" size={12} color={pin ? C.green : C.gold} strokeWidth={2.2} />
+          <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 11.5, color: pin ? C.green : C.gold }}>{pin ? 'Pin saved' : 'No pin yet'}</Text>
+          {pin ? <Icon name="chevRight" size={11} color={C.green} strokeWidth={2.4} /> : null}
+        </Pressable>
+        {!pin ? (
+          <Pressable onPress={() => setLocFor({ clientId: c.clientId, name: c.name })} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Add location for ${c.name}`}
+            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }}>
+            <Icon name="map" size={12} color={C.ink3} strokeWidth={2.1} />
+            <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.ink }}>Add location</Text>
+          </Pressable>
+        ) : null}
+      </View>
+    );
+  };
 
   // Unknown (loading / paused offline / errored) is not "denied".
   if (caps.isPending || caps.isError) return <AccessPending paused={caps.isPaused} error={caps.isError} onRetry={caps.refetch} />;
   if (!isMgr) {
@@ -10989,8 +11021,9 @@ export function QhpManager() {
                           </LinearGradient>
                         </Pressable>
                         <Pressable onPress={() => setHoldFor(c)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.purple, 0.12), borderWidth: 1, borderColor: hexA(C.purple, 0.4) }}><Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.purple }}>Hold</Text></Pressable>
                       </View>
+                      {pinRow(c)}
                     </View>
                   );
                 })
               ) : sub === 'sched' ? (
@@ -11024,8 +11057,9 @@ export function QhpManager() {
                         <Pressable onPress={() => { setCredsCopied(false); setCredsFor(c); }} style={{ width: 40, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                           <Icon name="copy" size={14} color={C.ink3} strokeWidth={2} />
                         </Pressable>
                       </View>
+                      {pinRow(c)}
                     </View>
                   );
                 })
               ) : sub === 'hold' ? (
@@ -11047,8 +11081,9 @@ export function QhpManager() {
                         <Icon name="calendar" size={13} color="#fff" strokeWidth={2.4} />
                         <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>Schedule QHP</Text>
                       </LinearGradient>
                     </Pressable>
+                    {pinRow(c)}
                   </View>
                 ))
               ) : (
                 d.reschedules.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No reschedule requests.</Body> :
@@ -11802,8 +11837,11 @@ export function QhpManager() {
 
       {/* Manager calendar "Add QHP" \u2014 blank sheet with its own client picker */}
       <ScheduleQhpSheet visible={mgrAddOpen} onClose={() => setMgrAddOpen(false)} scheduledBy={session?.user?.id ?? ''} />
 
+      {/* Add / Update client location (2 Nov 2026): the WhatsApp paste sheet behind the Task Pending card buttons */}
+      <ClientLocationSheet target={locFor} existing={locFor ? pins[locFor.clientId] ?? null : null} onClose={() => setLocFor(null)} />
+
       {/* Manager reschedule modal \u2014 14-day picker + tap-to-cycle time */}
       <Modal visible={!!reschedFor} transparent animationType="fade" onRequestClose={() => setReschedFor(null)}>
         <KbCenter onDismiss={() => setReschedFor(null)}>
           <Pressable onPress={() => {}} style={{ maxHeight: '100%', borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.blue, 0.3), padding: 18, gap: 13 }}>
```

### 3.7 Not to port
- The assessor's own capture on the QHP card (`useSaveClientHomeLocation`, only while the pin is empty) stays as it is.
- The QHP navigation screen already flags pins with method `ops_whatsapp_paste` as "check with the client"; pins from
  this sheet carry the same method on purpose.

### 3.8 Done when
- `node tests/rules/shared_location_test.js` and `node tests/rules/approval_requests_test.js` print ALL PASS; `npx
  tsc --noEmit` exits 0; the iOS bundle builds.

## 4. Check on the iPhone
1. As a QHP manager, open QHP Manager > Task Pending. Every Not Scheduled, Scheduled and On Hold card shows the pin
   row; a client without a pin reads "No pin yet" (amber) with **Add location**.
2. Tap Add location. The sheet opens with the empty hint. Paste `https://maps.app.goo.gl/abc`: the amber short-link
   line shows and Save stays off.
3. Replace it with `https://maps.google.com/?q=28.530761,77.106838`: the green box reads "Lat 28.530761 · Lng
   77.106838", "Read from Google Maps link"; Open in Google Maps opens the map at that point.
4. Tap Save location: the alert "Location saved" shows "28.530761, 77.106838", the sheet closes, the card's chip reads
   "Pin saved" (green) and the Add location button is gone. Tapping the chip opens Google Maps there.
5. A card whose client already had a pin shows "Pin saved" alone, no button.
6. Type `I have 12, 44 sessions left`: the red unreadable line shows (whole numbers in a sentence are not a pin).
7. Airplane mode: the sheet shows "No connection. The location can only be saved online." and Save is off.
8. As the assigned assessor: that client's QHP card offers Start navigation to the pin.
9. SQL: `select brb_location from clients where id = '<client>'` shows method `ops_whatsapp_paste`, accuracy null and
   `captured_by` = the manager's profile id.

Not confirmed: the iOS repo's `icons.tsx` has `pin`, `map` and `clipboard` (Android's does); `C.sheetBg` exists in
the iOS theme (it does on Android since the Session code sheet); no device test was possible on Android (no QHP
manager password), so the sheet was checked by type check, bundle and the rule tests only.
