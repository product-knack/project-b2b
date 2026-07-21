// notify-far-sessions — CRON (every 15 min): alert trainers ~2 HOURS BEFORE a
// session whose drive time from their latest logged location exceeds 60 minutes.
//
// Pipeline per run:
//   1. session_schedule rows starting 105–135 min from now (± the cron cadence
//      around the 2-hour mark), not cancelled, not logged.
//   2. Trainer's latest point from trainer_location_logs (service role) +
//      client's captured home (clients.brb_location). Either missing → skip.
//   3. Drive time via Google Routes (traffic-aware) → OSRM fallback (×1.35).
//   4. > 60 min → FCM push to the trainer (odds_device_tokens via pushToStaff),
//      deduped per session in far_session_alerts.
//
// Deploy:  supabase functions deploy notify-far-sessions --no-verify-jwt
// Secrets: GOOGLE_API_KEY, FIREBASE_SERVICE_ACCOUNT_JSON (already set), CRON_SECRET.
// Trigger: pg_cron + pg_net (see supabase/far_session_alerts_migration.sql).

import { createClient } from "npm:@supabase/supabase-js@2";
import { computeRoute, osrmRoute } from "../_shared/google-env.ts";
import { pushToStaff } from "../_shared/assistantPush.ts";

const ALERT_THRESHOLD_MIN = 60;   // drive time above this → alert
const WINDOW_START_MIN = 105;     // sessions starting between…
const WINDOW_END_MIN = 135;       // …minutes from now (~2h, one 15-min cron slot wide)
const MAX_LOCATION_AGE_MIN = 180; // ignore trainer fixes older than 3h

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

function parsePoint(p: any): { lat: number; lng: number; at: number } | null {
  if (!p || typeof p !== "object") return null;
  const lat = Number(p.lat ?? p.latitude);
  const lng = Number(p.lng ?? p.lon ?? p.longitude);
  const atRaw = p.at ?? p.captured_at ?? p.capturedAt ?? p.timestamp ?? p.time;
  const at = atRaw ? new Date(atRaw).getTime() : NaN;
  return isFinite(lat) && isFinite(lng) && isFinite(at) ? { lat, lng, at } : null;
}

Deno.serve(async (req) => {
  try {
    // Cron auth: shared secret header (function is deployed --no-verify-jwt).
    const secret = Deno.env.get("CRON_SECRET");
    if (secret && req.headers.get("x-cron-key") !== secret) return json({ ok: false, error: "unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = Date.now();
    const winStart = new Date(now + WINDOW_START_MIN * 60_000).toISOString();
    const winEnd = new Date(now + WINDOW_END_MIN * 60_000).toISOString();

    // 1. Upcoming sessions in the window.
    const { data: sessions, error: sErr } = await supabase
      .from("session_schedule")
      .select("id, trainer_id, client_id, scheduled_datetime, clients:client_id(first_name, last_name, brb_location)")
      .gte("scheduled_datetime", winStart)
      .lte("scheduled_datetime", winEnd)
      .neq("status", "cancelled")
      .is("workout_session_id", null);
    if (sErr) return json({ ok: false, error: sErr.message }, 500);
    if (!sessions?.length) return json({ ok: true, checked: 0, alerted: 0 });

    // 2. Skip sessions already alerted.
    const { data: sent } = await supabase
      .from("far_session_alerts").select("session_id")
      .in("session_id", sessions.map((s: any) => s.id));
    const already = new Set((sent ?? []).map((r: any) => r.session_id));

    // Latest location per trainer (fetch once per trainer).
    const trainerIds = [...new Set(sessions.map((s: any) => s.trainer_id).filter(Boolean))];
    const latestByTrainer = new Map<string, { lat: number; lng: number }>();
    for (const tid of trainerIds) {
      const { data: rows } = await supabase
        .from("trainer_location_logs").select("*")
        .eq("trainer_id", tid).order("log_date", { ascending: false }).limit(2);
      const pts = (rows ?? [])
        .flatMap((r: any) => (Array.isArray(r.points) ? r.points : []))
        .map(parsePoint).filter((p): p is NonNullable<ReturnType<typeof parsePoint>> => !!p)
        .sort((a, b) => b.at - a.at);
      const latest = pts[0];
      if (latest && (now - latest.at) / 60_000 <= MAX_LOCATION_AGE_MIN) {
        latestByTrainer.set(tid, { lat: latest.lat, lng: latest.lng });
      }
    }

    let alerted = 0;
    const results: any[] = [];
    for (const s of sessions as any[]) {
      if (already.has(s.id)) continue;
      const origin = s.trainer_id ? latestByTrainer.get(s.trainer_id) : null;
      const homeRaw = s.clients?.brb_location;
      const dest = homeRaw && isFinite(Number(homeRaw.lat)) && isFinite(Number(homeRaw.lng))
        ? { lat: Number(homeRaw.lat), lng: Number(homeRaw.lng) } : null;
      if (!origin || !dest) continue;

      // 3. Drive time: Google (traffic) → OSRM ×1.35 fallback.
      const o = { lat: origin.lat, lon: origin.lng };
      const d = { lat: dest.lat, lon: dest.lng };
      const { route: gRoute } = await computeRoute(o, d);
      const route = gRoute ?? (await osrmRoute(o, d).catch(() => null));
      if (!route) continue;
      const durMin = Math.round((gRoute ? route.durationSec : route.durationSec * 1.35) / 60);
      if (durMin <= ALERT_THRESHOLD_MIN) continue;

      // 4. Push + dedupe record.
      const clientName = `${s.clients?.first_name ?? ""} ${s.clients?.last_name ?? ""}`.trim() || "your client";
      const at = new Date(s.scheduled_datetime).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
      const km = (route.distanceMeters / 1000).toFixed(1);
      const res = await pushToStaff({
        supabase,
        userId: s.trainer_id,
        title: `🚗 Long drive to ${clientName} — leave early`,
        body: `Your ${at} session is ~${durMin} min away (${km} km) from your current location. Plan to leave soon.`,
        data: { type: "far_session_alert", session_id: s.id, client_id: s.client_id ?? "" },
      });
      await supabase.from("far_session_alerts").insert({ session_id: s.id, trainer_id: s.trainer_id, duration_min: durMin });
      alerted++;
      results.push({ session: s.id, durMin, pushed: res.success });
    }

    return json({ ok: true, checked: sessions.length, alerted, results });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
