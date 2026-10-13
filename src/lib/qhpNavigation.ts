/* QHP navigation (14 Oct 2026): the pure half. Geometry, the route projection
   that gives "distance left" between server refreshes, off-route and arrival
   tests, the GPS thinning that keeps the ride small, the track json written to
   coach_assessment.navigation_track, and the stale-pin rule. No app imports:
   node-tested in the session scratchpad. */

export type LatLng = [number, number]; // [lat, lng]

/** One kept GPS fix of the ride: seconds since start, lat, lng, accuracy m, speed m/s. */
export type TrackPoint = [number, number, number, number, number];

/** One turn-by-turn step: the manoeuvre at its start, then distanceMeters until the next. */
export type RouteStep = { maneuver: string; instruction: string; distanceMeters: number; polyline: string | null };

export type RouteInfo = {
  points: LatLng[];        // decoded planned route, origin to pin
  distanceKm: number;      // the server's planned distance at this refresh
  durationMin: number;     // the server's planned time at this refresh
  traffic: boolean;
  approx: boolean;         // the server itself fell back to a straight line
  fetchedAt: number;       // ms
  polyline: string | null;
  steps: RouteStep[];      // [] when the server had none (straight-line fallback, old function)
};

export const ROAD_FACTOR = 1.35;
export const CITY_KMH = 22;
export const OFF_ROUTE_M = 80;
export const ARRIVE_M = 60;
export const ROUTE_REFRESH_MS = 75_000;
export const ROUTE_MIN_GAP_MS = 20_000;
export const KEEP_MIN_M = 8;
export const KEEP_MIN_S = 10;
export const MAX_POINTS = 4000;
export const STALE_PIN_DAYS = 90;

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Metres between two points. */
export const haversineM = (a: LatLng, b: LatLng): number => {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
};

/** Initial bearing a -> b, degrees clockwise from north. */
export const bearingDeg = (a: LatLng, b: LatLng): number => {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
};

/* ---------- Google encoded polyline ---------- */
export function decodePolyline(str: string): LatLng[] {
  const out: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    let b = 0, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && index < str.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && index < str.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

export function encodePolyline(pts: LatLng[]): string {
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    return s + String.fromCharCode(n + 63);
  };
  let out = '', pLat = 0, pLng = 0;
  for (const [la, ln] of pts) {
    const a = Math.round(la * 1e5), b = Math.round(ln * 1e5);
    out += enc(a - pLat) + enc(b - pLng);
    pLat = a; pLng = b;
  }
  return out;
}

/* ---------- where am I on the planned route ---------- */
export type Projection = {
  /** metres from the position to the nearest point of the route */
  offM: number;
  /** metres along the route from its start to that nearest point */
  alongM: number;
  /** metres left to the end of the route from that point */
  remainingM: number;
  /** total route length in metres */
  totalM: number;
};

/** Nearest point of the polyline to `p`, with the distance left from there. Flat
    local metric (fine at city scale); O(n) per fix. */
export function projectOnRoute(p: LatLng, route: LatLng[]): Projection | null {
  if (!route || route.length < 2) return null;
  const kx = Math.cos(rad(p[0])) * 111320, ky = 110540; // metres per degree at this latitude
  const seg: number[] = [];
  let totalM = 0;
  for (let i = 1; i < route.length; i++) { const l = haversineM(route[i - 1], route[i]); seg.push(l); totalM += l; }
  let best = { offM: Infinity, alongM: 0 };
  let acc = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky;
    const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + dx * t, py = ay + dy * t;
    const offM = Math.sqrt(px * px + py * py);
    if (offM < best.offM) best = { offM, alongM: acc + seg[i - 1] * t };
    acc += seg[i - 1];
  }
  return { offM: best.offM, alongM: best.alongM, remainingM: Math.max(0, totalM - best.alongM), totalM };
}

export const isOffRoute = (proj: Projection | null, accuracyM: number | null | undefined): boolean =>
  !!proj && proj.offM > Math.max(OFF_ROUTE_M, (accuracyM ?? 0) * 1.5);

export const isArrived = (p: LatLng, pin: LatLng, accuracyM: number | null | undefined): boolean =>
  haversineM(p, pin) <= Math.max(ARRIVE_M, Math.min(accuracyM ?? 0, 150));

/* ---------- the numbers on the card ---------- */
export type Estimate = { km: number; min: number; local: boolean };

/** Distance and time left. With a route: the remaining part of the planned line,
    time scaled from the server's planned time. Without: straight line times the
    road factor at the city speed (the phone-only fallback). */
export function estimateLeft(p: LatLng, pin: LatLng, route: RouteInfo | null, proj: Projection | null): Estimate {
  if (route && proj && route.points.length >= 2 && proj.totalM > 0) {
    const frac = proj.remainingM / proj.totalM;
    const km = +(proj.remainingM / 1000).toFixed(1);
    const min = Math.max(1, Math.round(route.durationMin * frac));
    return { km, min, local: false };
  }
  const km = +((haversineM(p, pin) / 1000) * ROAD_FACTOR).toFixed(1);
  return { km, min: Math.max(1, Math.round((km / CITY_KMH) * 60)), local: true };
}

/** "3:48 PM" in IST for now + minutes. */
export const arrivalClock = (nowMs: number, minutes: number): string => {
  const d = new Date(nowMs + minutes * 60_000);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`.trim();
};

/** "20 s ago" / "1 min ago" / "4 min ago". */
export const agoText = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  return `${Math.round(s / 60)} min ago`;
};

/* ---------- GPS thinning ---------- */
export type Fix = { t: number; lat: number; lng: number; acc: number | null; spd: number | null; heading?: number | null };

/** Keep a fix when it moved at least KEEP_MIN_M from the last kept one or KEEP_MIN_S passed. */
export const shouldKeep = (last: TrackPoint | null, f: Fix, startMs: number): boolean => {
  if (!last) return true;
  const dt = (f.t - startMs) / 1000 - last[0];
  if (dt >= KEEP_MIN_S) return true;
  return haversineM([last[1], last[2]], [f.lat, f.lng]) >= KEEP_MIN_M;
};

export const toPoint = (f: Fix, startMs: number): TrackPoint => [
  Math.max(0, Math.round((f.t - startMs) / 1000)),
  +f.lat.toFixed(5), +f.lng.toFixed(5),
  f.acc == null ? 0 : Math.round(f.acc),
  f.spd == null || f.spd < 0 ? 0 : +f.spd.toFixed(1),
];

/** Over the cap: drop every other point of the older half, keeping the first and the last. */
export const capPoints = (pts: TrackPoint[], max: number = MAX_POINTS): TrackPoint[] => {
  if (pts.length <= max) return pts;
  const half = Math.floor(pts.length / 2);
  const older = pts.slice(0, half).filter((_, i) => i % 2 === 0);
  return [...older, ...pts.slice(half)];
};

/** Heading for the marker: the GPS heading while moving, else the bearing from the
    previous fix when it moved enough, else the last known heading. */
export const headingFrom = (prev: Fix | null, cur: Fix, lastHeading: number): number => {
  if (cur.heading != null && cur.heading >= 0 && (cur.spd ?? 0) > 1) return cur.heading;
  if (prev && haversineM([prev.lat, prev.lng], [cur.lat, cur.lng]) >= 5) return bearingDeg([prev.lat, prev.lng], [cur.lat, cur.lng]);
  return lastHeading;
};

export const MOVING_MPS = 0.8;
export const isMoving = (prev: Fix | null, cur: Fix): boolean => {
  if ((cur.spd ?? 0) > MOVING_MPS) return true;
  if (!prev) return false;
  const dt = (cur.t - prev.t) / 1000;
  return dt > 0 && haversineM([prev.lat, prev.lng], [cur.lat, cur.lng]) / dt > MOVING_MPS;
};

/* ---------- the stored json ---------- */
export type NavigationTrack = {
  version: 1;
  started_at: string;
  ended_at: string | null;
  arrived_at: string | null;
  ended_by: 'arrived' | 'ended' | null;
  distance_km: number;
  duration_min: number;
  avg_kmh: number;
  arrival_gap_m: number | null;
  planned_km: number | null;
  planned_min: number | null;
  planned_polyline: string | null;
  points: TrackPoint[];
  polyline: string;
  pin: { lat: number; lng: number; captured_at: string | null; method: string | null };
  source: 'android' | 'ios';
  app_version: string | null;
};

export const trackDistanceM = (pts: TrackPoint[]): number => {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += haversineM([pts[i - 1][1], pts[i - 1][2]], [pts[i][1], pts[i][2]]);
  return m;
};

export function buildTrack(i: {
  startMs: number; endMs: number | null; endedBy: 'arrived' | 'ended' | null; points: TrackPoint[];
  pin: { lat: number; lng: number; captured_at: string | null; method: string | null };
  planned: { km: number; min: number; polyline: string | null } | null;
  last: LatLng | null; source: 'android' | 'ios'; appVersion: string | null;
}): NavigationTrack {
  const pts = capPoints(i.points);
  const distM = trackDistanceM(pts);
  const endMs = i.endMs ?? (pts.length ? i.startMs + pts[pts.length - 1][0] * 1000 : i.startMs);
  const durMin = Math.max(0, Math.round((endMs - i.startMs) / 60_000));
  const hours = (endMs - i.startMs) / 3_600_000;
  return {
    version: 1,
    started_at: new Date(i.startMs).toISOString(),
    ended_at: i.endMs ? new Date(i.endMs).toISOString() : null,
    arrived_at: i.endedBy === 'arrived' && i.endMs ? new Date(i.endMs).toISOString() : null,
    ended_by: i.endedBy,
    distance_km: +(distM / 1000).toFixed(2),
    duration_min: durMin,
    avg_kmh: hours > 0.01 ? +((distM / 1000) / hours).toFixed(1) : 0,
    arrival_gap_m: i.last ? Math.round(haversineM(i.last, [i.pin.lat, i.pin.lng])) : null,
    planned_km: i.planned?.km ?? null,
    planned_min: i.planned?.min ?? null,
    planned_polyline: i.planned?.polyline ?? null,
    points: pts,
    polyline: encodePolyline(pts.map((p) => [p[1], p[2]] as LatLng)),
    pin: i.pin,
    source: i.source,
    app_version: i.appVersion,
  };
}

/* ---------- stale pin ---------- */
export type StalePin = { stale: boolean; reason: string | null };
/** A pin older than 90 days, or pasted by ops rather than captured on site, is flagged (never blocked). */
export function stalePin(capturedAt: string | null | undefined, method: string | null | undefined, nowMs: number = Date.now()): StalePin {
  const pasted = !!method && /paste|ops/i.test(method);
  const t = capturedAt ? Date.parse(capturedAt) : NaN;
  const days = isFinite(t) ? Math.floor((nowMs - t) / 86_400_000) : null;
  if (days != null && days > STALE_PIN_DAYS) {
    const when = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t));
    const months = Math.round(days / 30);
    return { stale: true, reason: `Pin captured ${when}, ${months >= 2 ? `${months} months` : `${days} days`} ago. Confirm the address with the client before you set off.` };
  }
  if (pasted) return { stale: true, reason: 'Pin came from a pasted location, not a capture at the door. Confirm the address with the client before you set off.' };
  return { stale: false, reason: null };
}

/* ---------- turn-by-turn (14 Oct 2026, user: "tell like after 400 metres turn left") ---------- */
export type ManeuverKind =
  | 'left' | 'right' | 'slight-left' | 'slight-right' | 'sharp-left' | 'sharp-right'
  | 'uturn-left' | 'uturn-right' | 'straight' | 'roundabout-left' | 'roundabout-right'
  | 'merge' | 'fork-left' | 'fork-right' | 'ramp-left' | 'ramp-right' | 'depart' | 'arrive' | 'ferry';

/** Google's manoeuvre enum (also what the OSRM fallback is mapped to) -> the icon / phrase kind. */
export const maneuverKind = (m: string | null | undefined): ManeuverKind => {
  const u = (m ?? '').toUpperCase();
  const side = u.endsWith('_LEFT') ? 'left' : u.endsWith('_RIGHT') ? 'right' : null;
  if (u === 'DEPART') return 'depart';
  if (u === 'ARRIVE' || u === 'DESTINATION') return 'arrive';
  if (u.startsWith('FERRY')) return 'ferry';
  if (u.startsWith('UTURN')) return side === 'right' ? 'uturn-right' : 'uturn-left';
  if (u.startsWith('TURN_SHARP')) return side === 'right' ? 'sharp-right' : 'sharp-left';
  if (u.startsWith('TURN_SLIGHT')) return side === 'right' ? 'slight-right' : 'slight-left';
  if (u.startsWith('TURN_')) return side === 'right' ? 'right' : 'left';
  if (u.startsWith('ROUNDABOUT')) return side === 'right' ? 'roundabout-right' : 'roundabout-left';
  if (u === 'MERGE') return 'merge';
  if (u.startsWith('FORK')) return side === 'right' ? 'fork-right' : 'fork-left';
  if (u.startsWith('RAMP') || u.startsWith('ON_RAMP') || u.startsWith('OFF_RAMP')) return side === 'right' ? 'ramp-right' : 'ramp-left';
  return 'straight';
};

/** Google writes two lines: the manoeuvre, then a landmark ("Pass by the church (on the left)"). */
export const instructionTitle = (instruction: string | null | undefined): string =>
  (instruction ?? '').split('\n')[0].replace(/\s+/g, ' ').replace(/[.]+$/, '').trim();
export const instructionNote = (instruction: string | null | undefined): string | null => {
  const rest = (instruction ?? '').split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();
  return rest || null;
};

/** The road name out of an instruction: "Turn left onto Maulsari Ave" -> "Maulsari Ave". */
export const streetOf = (instruction: string | null | undefined): string | null => {
  const s = instructionTitle(instruction);
  if (!s) return null;
  const m = s.match(/\b(?:onto|on|to stay on|toward|towards)\s+(.+?)(?:\s+(?:toward|towards)\s+.+)?[.]?$/i);
  if (!m) return null;
  const name = m[1].replace(/[.]+$/, '').trim();
  return name && name.length <= 60 ? name : null;
};

/** "300 m" / "1.2 km" / "12 km" the way a navigation banner rounds. */
export const fmtStepDistance = (m: number): string => {
  if (!(m >= 0)) return '';
  if (m >= 10_000) return `${Math.round(m / 1000)} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace(/\.0$/, '')} km`;
  if (m >= 100) return `${Math.round(m / 50) * 50} m`;
  return `${Math.max(10, Math.round(m / 10) * 10)} m`;
};

/** How the instruction joins the road name: "onto X", "toward X", "to stay on X", "on X". */
export type StreetPrep = 'onto' | 'toward' | 'to stay on' | 'on';
export const prepOf = (instruction: string | null | undefined): StreetPrep => {
  const s = instructionTitle(instruction);
  if (/\btowards?\b/i.test(s)) return 'toward';
  if (/\bto stay on\b/i.test(s)) return 'to stay on';
  if (/\bonto\b/i.test(s)) return 'onto';
  return 'on';
};

export type Maneuver = {
  index: number;           // step index whose start is the manoeuvre
  kind: ManeuverKind;
  instruction: string;     // first line only ("Turn left onto Sri Aurobindo Marg")
  note: string | null;     // Google's landmark line, when any
  street: string | null;
  prep: StreetPrep;
  distanceM: number;       // from the rider to the manoeuvre
  then: { kind: ManeuverKind; street: string | null; prep: StreetPrep; gapM: number } | null; // the one after, when it follows within 250 m
};

/** The next manoeuvre ahead of `alongM` metres into the route. Step i's manoeuvre sits at the
    cumulative start of step i; the last step's end is the arrival. */
export function nextManeuver(alongM: number, steps: RouteStep[], totalM: number): Maneuver | null {
  if (!steps.length) return null;
  const starts: number[] = [];
  let acc = 0;
  for (const s of steps) { starts.push(acc); acc += Math.max(0, s.distanceMeters || 0); }
  const end = Math.max(acc, totalM || 0);
  const tol = 15; // metres: a manoeuvre just behind still counts as passed
  for (let i = 1; i < steps.length; i++) {
    if (starts[i] - alongM > -tol && starts[i] >= alongM - tol) {
      const s = steps[i];
      const kind = maneuverKind(s.maneuver);
      const nxt = steps[i + 1];
      const gap = nxt ? starts[i + 1] - starts[i] : Infinity;
      return {
        index: i, kind, instruction: instructionTitle(s.instruction), note: instructionNote(s.instruction), street: streetOf(s.instruction), prep: prepOf(s.instruction),
        distanceM: Math.max(0, starts[i] - alongM),
        then: nxt && gap <= 250 ? { kind: maneuverKind(nxt.maneuver), street: streetOf(nxt.instruction), prep: prepOf(nxt.instruction), gapM: gap } : null,
      };
    }
  }
  return { index: steps.length, kind: 'arrive', instruction: 'Arrive at your destination', note: null, street: null, prep: 'on', distanceM: Math.max(0, end - alongM), then: null };
}

/** Spoken form of a manoeuvre: "turn left onto Maulsari Avenue". */
export const maneuverPhrase = (kind: ManeuverKind, street: string | null, prep: StreetPrep = 'onto'): string => {
  const onto = street ? ` ${prep} ${expandRoad(street)}` : '';
  switch (kind) {
    case 'left': return `turn left${onto}`;
    case 'right': return `turn right${onto}`;
    case 'slight-left': return `keep left${onto}`;
    case 'slight-right': return `keep right${onto}`;
    case 'sharp-left': return `turn sharp left${onto}`;
    case 'sharp-right': return `turn sharp right${onto}`;
    case 'uturn-left': case 'uturn-right': return `make a U-turn${onto}`;
    case 'roundabout-left': case 'roundabout-right': return `take the roundabout${onto}`;
    case 'merge': return `merge${onto}`;
    case 'fork-left': return `keep left at the fork${onto}`;
    case 'fork-right': return `keep right at the fork${onto}`;
    case 'ramp-left': return `take the ramp on the left${onto}`;
    case 'ramp-right': return `take the ramp on the right${onto}`;
    case 'ferry': return 'take the ferry';
    case 'depart': return street ? `head out on ${expandRoad(street)}` : 'head out';
    case 'arrive': return 'arrive at your destination';
    default: return `continue straight${street ? ` on ${expandRoad(street)}` : ''}`;
  }
};

/** "Ave" -> "Avenue" etc. so the voice reads naturally. */
export const expandRoad = (s: string): string =>
  s.replace(/\bAve\b\.?/g, 'Avenue').replace(/\bRd\b\.?/g, 'Road').replace(/\bSt\b\.?/g, 'Street').replace(/\bMg\b\.?/g, 'Marg').replace(/\bBlvd\b\.?/g, 'Boulevard').replace(/\bLn\b\.?/g, 'Lane').replace(/\bHwy\b\.?/g, 'Highway').replace(/\bNH\s?(\d+)/g, 'National Highway $1');

/** Spoken distance: "In 400 metres" (rounded like the banner), "In 1.2 kilometres". */
export const spokenDistance = (m: number): string => {
  if (m >= 1000) return `In ${fmtStepDistance(m).replace(' km', ' kilometres')}`;
  return `In ${fmtStepDistance(m).replace(' m', ' metres')}`;
};

export type VoiceCue = { id: string; text: string };
export const ARRIVE_CUE = 'arrive:near';
/** Which cue to speak now, if any: a far cue once under 400 m (over 150 m), a near cue once
    under 70 m, the arrival once. `spoken` holds the ids already said. */
export function voiceCue(m: Maneuver | null, spoken: Set<string>): VoiceCue | null {
  if (!m) return null;
  const far = `${m.index}:far`, near = `${m.index}:near`;
  if (m.kind === 'arrive') {
    // fixed ids so the geofence arrival (ARRIVE_M) and this cue never both speak
    if (m.distanceM <= 70 && !spoken.has(ARRIVE_CUE)) return { id: ARRIVE_CUE, text: 'You have arrived at your destination.' };
    if (m.distanceM <= 400 && m.distanceM > 70 && !spoken.has('arrive:far')) return { id: 'arrive:far', text: `${spokenDistance(m.distanceM)}, you will arrive at your destination.` };
    return null;
  }
  if (m.distanceM <= 70 && !spoken.has(near)) {
    const thenText = m.then ? `, then ${maneuverPhrase(m.then.kind, m.then.street, m.then.prep)}` : '';
    return { id: near, text: `${cap(maneuverPhrase(m.kind, m.street, m.prep))}${thenText}.` };
  }
  if (m.distanceM <= 400 && m.distanceM > 70 && !spoken.has(far)) return { id: far, text: `${spokenDistance(m.distanceM)}, ${maneuverPhrase(m.kind, m.street, m.prep)}.` };
  return null;
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The map's own copy of the thresholds (kept in one place). */
export const NAV_CONSTANTS = { OFF_ROUTE_M, ARRIVE_M, ROUTE_REFRESH_MS, ROUTE_MIN_GAP_MS };
