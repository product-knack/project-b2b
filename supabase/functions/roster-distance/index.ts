// roster-distance — distance/time/map between the calling trainer's latest
// logged location (trainer_location_logs, read via SERVICE ROLE so the table's
// admin-only RLS stays intact) and a client's captured home (clients.brb_location).
//
// POST body: { client_id: string }
// 200 → { ok: true, distanceKm, durationMin, locationAgeMin, clientLat, clientLng,
//          clientName, clientAddress, mapImageBase64 }
// 200 → { ok: false, error: 'no_client_location' | 'no_trainer_location' | 'stale_location' | ... }
//
// Deploy: supabase functions deploy roster-distance
// Secrets used: GOOGLE_API_KEY (already set), SUPABASE_* (auto-injected).

import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { computeRoute, osrmRoute, staticRouteMap, reverseGeocode } from "../_shared/google-env.ts";

const MAX_LOCATION_AGE_MIN = 120; // hourly capture cadence → allow up to 2h before "stale"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* trainer_location_logs is day-model: one row per trainer per IST day with a JSON
   points array appended by the append_trainer_location RPC. Point key names are
   parsed defensively (lat/latitude, lng/lon/longitude, at/captured_at/timestamp). */
function parsePoint(p: any): { lat: number; lng: number; at: number } | null {
  if (!p || typeof p !== "object") return null;
  const lat = Number(p.lat ?? p.latitude);
  const lng = Number(p.lng ?? p.lon ?? p.longitude);
  const atRaw = p.at ?? p.captured_at ?? p.capturedAt ?? p.timestamp ?? p.time;
  const at = atRaw ? new Date(atRaw).getTime() : NaN;
  if (!isFinite(lat) || !isFinite(lng) || !isFinite(at)) return null;
  return { lat, lng, at };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // Identify the caller from their JWT (anon client bound to the request's auth header).
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userData } = await authClient.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const client_id = body?.client_id;
    if (!client_id) return json({ ok: false, error: "client_id required" }, 400);
    // Optional live origin from the device — preferred over the hourly log when present.
    const liveLat = Number(body?.origin?.lat), liveLng = Number(body?.origin?.lng);
    const liveOrigin = isFinite(liveLat) && isFinite(liveLng) ? { lat: liveLat, lng: liveLng } : null;

    // Service role for data reads — bypasses RLS deliberately (see header note).
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Guard: the caller must actually be assigned to this client — either via
    // trainer_clients (trainers/doctors) OR a scheduled session_schedule row
    // (doctor rosters are HOD-created and don't always have a trainer_clients row).
    const { data: assignment } = await admin
      .from("trainer_clients").select("id")
      .eq("trainer_id", uid).eq("client_id", client_id).limit(1).maybeSingle();
    if (!assignment) {
      const { data: rostered } = await admin
        .from("session_schedule").select("id")
        .eq("trainer_id", uid).eq("client_id", client_id).neq("status", "cancelled")
        .limit(1).maybeSingle();
      if (!rostered) return json({ ok: false, error: "not_your_client" }, 403);
    }

    // Client home + display fields.
    const { data: client } = await admin
      .from("clients").select("first_name, last_name, location, brb_location")
      .eq("id", client_id).maybeSingle();
    const home = client?.brb_location;
    const clientLat = Number(home?.lat), clientLng = Number(home?.lng);
    if (!isFinite(clientLat) || !isFinite(clientLng)) return json({ ok: false, error: "no_client_location" });

    // Origin: the device's live fix when supplied; otherwise the trainer's latest
    // logged point (last 2 day-rows to cover the midnight boundary, newest wins).
    let origin: { lat: number; lon: number };
    let ageMin: number;
    if (liveOrigin) {
      origin = { lat: liveOrigin.lat, lon: liveOrigin.lng };
      ageMin = 0;
    } else {
      const { data: logRows } = await admin
        .from("trainer_location_logs").select("*")
        .eq("trainer_id", uid).order("log_date", { ascending: false }).limit(2);
      const points = (logRows ?? [])
        .flatMap((r: any) => (Array.isArray(r.points) ? r.points : []))
        .map(parsePoint)
        .filter((p): p is NonNullable<ReturnType<typeof parsePoint>> => !!p)
        .sort((a, b) => b.at - a.at);
      const latest = points[0];
      if (!latest) return json({ ok: false, error: "no_trainer_location" });
      ageMin = Math.round((Date.now() - latest.at) / 60000);
      if (ageMin > MAX_LOCATION_AGE_MIN) return json({ ok: false, error: "stale_location", locationAgeMin: ageMin });
      origin = { lat: latest.lat, lon: latest.lng };
    }
    const dest = { lat: clientLat, lon: clientLng };
    // Route resolution: Google Routes (traffic-aware) → OSRM (real roads, no
    // traffic) → haversine straight-line guess as the last resort.
    const { route: gRoute, detail } = await computeRoute(origin, dest);
    const route = gRoute ?? (await osrmRoute(origin, dest).catch(() => null));

    let distanceKm: number, durationMin: number, approx = false, polyline: string | null = null;
    const traffic = !!gRoute; // only Google durations are traffic-aware
    if (route) {
      distanceKm = +(route.distanceMeters / 1000).toFixed(1);
      // OSRM assumes free-flowing roads — scale for Indian metro traffic (~×1.35).
      const durSec = gRoute ? route.durationSec : route.durationSec * 1.35;
      durationMin = Math.max(1, Math.round(durSec / 60));
      polyline = route.encodedPolyline;
    } else {
      const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(dest.lat - origin.lat), dLon = toRad(dest.lon - origin.lon);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(origin.lat)) * Math.cos(toRad(dest.lat)) * Math.sin(dLon / 2) ** 2;
      const straight = 2 * R * Math.asin(Math.sqrt(a));
      distanceKm = +(straight * 1.35).toFixed(1); // road factor over straight line
      durationMin = Math.max(1, Math.round((distanceKm / 22) * 60));
      approx = true;
    }

    const [png, originPlace] = await Promise.all([
      staticRouteMap(origin, dest, polyline).catch(() => null),
      reverseGeocode(origin).catch(() => null),
    ]);
    // Keyless fallback when the Google Geocoding API is blocked on this key.
    let originName = originPlace?.label || null;
    if (!originName) {
      try {
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${origin.lat}&longitude=${origin.lon}&localityLanguage=en`);
        if (r.ok) {
          const g = await r.json();
          originName = [g?.locality, g?.city && g.city !== g.locality ? g.city : null].filter(Boolean).join(", ")
            || g?.city || g?.principalSubdivision || null;
        }
      } catch { /* leave null */ }
    }

    return json({
      ok: true,
      approx,
      traffic,
      routeDetail: gRoute ? null : detail ?? null, // Google's rejection reason, even when OSRM covered it (debugging)
      distanceKm, durationMin,
      locationAgeMin: ageMin,
      originName, // where the trainer's point actually is (Google label, else BigDataCloud)
      clientLat, clientLng,
      clientName: `${client?.first_name ?? ""} ${client?.last_name ?? ""}`.trim(),
      clientAddress: client?.location ?? null,
      mapImageBase64: png ? encodeBase64(png) : null,
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
