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
