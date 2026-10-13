// Server-side Google Maps Platform helpers.
// Requires Supabase secret: GOOGLE_API_KEY
// Never call these from the browser — edge functions only.

type Coords = { lat: number; lon: number };
type Place = { city: string; country: string; countryCode: string; label?: string };

const KEY = () => {
  const k = Deno.env.get("GOOGLE_API_KEY");
  if (!k) throw new Error("GOOGLE_API_KEY not set");
  return k;
};

// --- Reverse geocode (Google) -----------------------------------------------
export async function reverseGeocode(c: Coords): Promise<Place | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${c.lat},${c.lon}&key=${KEY()}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  const comps = j?.results?.[0]?.address_components ?? [];
  const pick = (t: string) => comps.find((x: any) => x.types?.includes(t));
  const city = pick("locality")?.long_name || pick("postal_town")?.long_name
            || pick("administrative_area_level_2")?.long_name
            || pick("administrative_area_level_1")?.long_name || "";
  const country = pick("country")?.long_name || "";
  const countryCode = (pick("country")?.short_name || "").toLowerCase();
  // Human label for "where is this point": neighbourhood + city (e.g. "Hauz Khas, New Delhi").
  const area = pick("sublocality_level_1")?.long_name || pick("sublocality")?.long_name
            || pick("neighborhood")?.long_name || pick("route")?.long_name || "";
  const label = [area, city].filter(Boolean).join(", ") || city || "";
  return city && country ? { city, country, countryCode, label } : null;
}

// --- Air Quality (Google) ---------------------------------------------------
// Uses local country AQI code (e.g. ind_cpcb, nor_norway), NOT universal uaqi.
const COUNTRY_AQI: Record<string, string> = {
  in: "ind_cpcb", no: "nor_norway", us: "usa_epa", gb: "gbr_defra",
  fr: "fra_atmo", de: "deu_uba", ca: "can_ec", au: "aus_combined",
};

export async function airQuality(c: Coords, countryCode?: string) {
  const local = countryCode ? COUNTRY_AQI[countryCode.toLowerCase()] : undefined;
  const body: any = {
    location: { latitude: c.lat, longitude: c.lon },
    extraComputations: ["LOCAL_AQI", "POLLUTANT_CONCENTRATION", "HEALTH_RECOMMENDATIONS"],
    universalAqi: true,
  };
  if (local) body.customLocalAqis = [{ regionCode: countryCode, aqi: local }];
  const r = await fetch(
    `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${KEY()}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!r.ok) return null;
  return await r.json();
}

// --- Weather (Google) — optional --------------------------------------------
export async function currentWeather(c: Coords) {
  const url = `https://weather.googleapis.com/v1/currentConditions:lookup`
            + `?key=${KEY()}&location.latitude=${c.lat}&location.longitude=${c.lon}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  return await r.json();
}

// --- Routes API: driving distance + traffic-aware duration + turn-by-turn steps --
/* One step = the manoeuvre at its start (Google's navigationInstruction) and the distance
   travelled after it until the next one. maneuver is Google's enum (TURN_LEFT, ...). */
export type RouteStep = { maneuver: string; instruction: string; distanceMeters: number; polyline: string | null };
export type RouteResult = { distanceMeters: number; durationSec: number; encodedPolyline: string | null; steps?: RouteStep[] };
export type RouteOutcome = { route: RouteResult | null; detail?: string };

export async function computeRoute(origin: Coords, dest: Coords): Promise<RouteOutcome> {
  const r = await fetch(
    `https://routes.googleapis.com/directions/v2:computeRoutes?key=${KEY()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.navigationInstruction,routes.legs.steps.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lon } } },
        destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lon } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        languageCode: "en-IN",
        units: "METRIC",
      }),
    },
  );
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text)?.error?.message ?? msg; } catch { /* keep raw */ }
    return { route: null, detail: `routes_http_${r.status}: ${msg}` };
  }
  let j: any = null;
  try { j = JSON.parse(text); } catch { return { route: null, detail: "routes_bad_json" }; }
  const route = j?.routes?.[0];
  if (!route?.distanceMeters) return { route: null, detail: `routes_empty: ${text.slice(0, 200)}` };
  const steps: RouteStep[] = ((route.legs ?? []) as any[]).flatMap((l) => (l.steps ?? []) as any[]).map((s) => ({
    maneuver: String(s.navigationInstruction?.maneuver ?? "STRAIGHT"),
    instruction: String(s.navigationInstruction?.instructions ?? ""),
    distanceMeters: Number(s.distanceMeters ?? 0) || 0,
    polyline: s.polyline?.encodedPolyline ?? null,
  }));
  return {
    route: {
      distanceMeters: route.distanceMeters,
      durationSec: parseInt(String(route.duration ?? "0").replace(/s$/, ""), 10) || 0,
      encodedPolyline: route.polyline?.encodedPolyline ?? null,
      steps,
    },
  };
}

// --- OSRM (keyless) fallback: real road routing when Routes API is blocked --
// Public demo server; no traffic awareness, but actual road distance + drive time,
// and turn-by-turn steps mapped onto Google's manoeuvre names.
function osrmManeuver(m: any): string {
  const type = String(m?.type ?? "");
  const mod = String(m?.modifier ?? "");
  const side = /left/.test(mod) ? "LEFT" : /right/.test(mod) ? "RIGHT" : "";
  if (type === "depart") return "DEPART";
  if (type === "arrive") return "ARRIVE";
  if (type === "roundabout" || type === "rotary") return side ? `ROUNDABOUT_${side}` : "ROUNDABOUT_LEFT";
  if (type === "merge") return "MERGE";
  if (type === "fork") return side ? `FORK_${side}` : "STRAIGHT";
  if (type === "on ramp" || type === "off ramp") return side ? `RAMP_${side}` : "STRAIGHT";
  if (type === "new name") return "NAME_CHANGE";
  if (/uturn/.test(mod)) return side ? `UTURN_${side}` : "UTURN_LEFT";
  if (/sharp/.test(mod) && side) return `TURN_SHARP_${side}`;
  if (/slight/.test(mod) && side) return `TURN_SLIGHT_${side}`;
  if (side) return `TURN_${side}`;
  return "STRAIGHT";
}
function osrmText(s: any): string {
  const name = String(s?.name ?? "").trim();
  const k = osrmManeuver(s?.maneuver);
  const onto = name ? ` onto ${name}` : "";
  if (k === "DEPART") return name ? `Head on ${name}` : "Head out";
  if (k === "ARRIVE") return "You have arrived at your destination";
  if (k.startsWith("TURN_SHARP_")) return `Turn sharp ${k.endsWith("LEFT") ? "left" : "right"}${onto}`;
  if (k.startsWith("TURN_SLIGHT_")) return `Turn slight ${k.endsWith("LEFT") ? "left" : "right"}${onto}`;
  if (k.startsWith("TURN_")) return `Turn ${k.endsWith("LEFT") ? "left" : "right"}${onto}`;
  if (k.startsWith("UTURN_")) return `Make a U-turn${onto}`;
  if (k.startsWith("ROUNDABOUT_")) return `At the roundabout, continue${onto}`;
  if (k === "MERGE") return `Merge${onto}`;
  if (k.startsWith("FORK_")) return `Keep ${k.endsWith("LEFT") ? "left" : "right"}${onto}`;
  if (k.startsWith("RAMP_")) return `Take the ramp on the ${k.endsWith("LEFT") ? "left" : "right"}${onto}`;
  return name ? `Continue onto ${name}` : "Continue straight";
}
export async function osrmRoute(origin: Coords, dest: Coords): Promise<RouteResult | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?overview=full&geometries=polyline&steps=true`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const j = await r.json();
  const route = j?.routes?.[0];
  if (!route?.distance) return null;
  const steps: RouteStep[] = ((route.legs?.[0]?.steps ?? []) as any[]).map((s) => ({
    maneuver: osrmManeuver(s.maneuver),
    instruction: osrmText(s),
    distanceMeters: Math.round(Number(s.distance ?? 0)) || 0,
    polyline: s.geometry ?? null,
  }));
  return {
    distanceMeters: Math.round(route.distance),
    durationSec: Math.round(route.duration),
    encodedPolyline: route.geometry ?? null,
    steps,
  };
}

// --- Static Maps: route image with both markers, returned as PNG bytes ------
export async function staticRouteMap(origin: Coords, dest: Coords, encodedPolyline: string | null): Promise<Uint8Array | null> {
  const params = new URLSearchParams({ size: "640x400", scale: "2", maptype: "roadmap", key: KEY() });
  const url =
    `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}` +
    `&markers=${encodeURIComponent(`color:orange|label:T|${origin.lat},${origin.lon}`)}` +
    `&markers=${encodeURIComponent(`color:green|label:C|${dest.lat},${dest.lon}`)}` +
    (encodedPolyline ? `&path=${encodeURIComponent(`weight:4|color:0xF97316FF|enc:${encodedPolyline}`)}` : "");
  const r = await fetch(url);
  if (!r.ok) return null;
  return new Uint8Array(await r.arrayBuffer());
}
