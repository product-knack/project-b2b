// ============ analyze-chat-reschedule ============
// AI layer for chat-agreed reschedules. Invoked by a pg_net trigger on messages
// INSERT (see chat_reschedule_migration.sql) AFTER a cheap SQL prefilter.
//
// Accuracy contract:
//  - The model only EXTRACTS; it never writes. Output is strict JSON with the
//    session chosen from a provided candidate list (it cannot invent one).
//  - Gates before a suggestion row is written: confidence >= 0.75, proposed
//    time in the future, SAME IST DAY as the candidate session (v1 rule),
//    proposed differs from the current time.
//  - The suggestion is only ever a chip in the trainer's chat; the trainer's
//    tap (chat_accept_reschedule RPC) is the sole write path.
// Auth: CRON_SECRET header, same as the other pg_net-invoked functions.
// Model: Gemini 2.5 Flash via GEMINI_API_KEY (Google) or LOVABLE_API_KEY
// (Lovable gateway) — same autodetect as the hub-track doctor-consult fn.
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const IST = "Asia/Kolkata";
const istDate = (d: Date | string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
const istClock = (d: Date | string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));

const SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["reschedule", "none"] },
    session_id: { type: "string" },
    new_time: { type: "string", description: "HH:mm 24h IST" },
    confidence: { type: "number" },
    evidence: { type: "string", description: "exact quoted message line" },
  },
  required: ["intent", "confidence"],
};

async function callGemini(prompt: string): Promise<any | null> {
  const gemKey = Deno.env.get("GEMINI_API_KEY");
  const lovKey = Deno.env.get("LOVABLE_API_KEY");
  if (gemKey) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${gemKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
        }),
      },
    );
    if (!r.ok) { console.error("gemini error", r.status, await r.text()); return null; }
    const d = await r.json();
    const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
    try { return JSON.parse(text); } catch { return null; }
  }
  if (lovKey) {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) { console.error("lovable error", r.status, await r.text()); return null; }
    const d = await r.json();
    try { return JSON.parse(d?.choices?.[0]?.message?.content); } catch { return null; }
  }
  console.error("no AI key configured (GEMINI_API_KEY / LOVABLE_API_KEY)");
  return null;
}

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get("CRON_SECRET");
    if (secret && req.headers.get("x-cron-key") !== secret) return json({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { message_id, conversation_id, client_id } = body ?? {};
    if (!message_id || !conversation_id || !client_id) return json({ ok: false, error: "missing fields" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Candidate sessions: the ONLY sessions the model may pick from.
    const now = new Date();
    const { data: candidates } = await supabase
      .from("session_schedule")
      .select("id, trainer_id, scheduled_datetime, modality, status, workout_session_id")
      .eq("client_id", client_id)
      .gte("scheduled_datetime", new Date(now.getTime() - 2 * 3600e3).toISOString())
      .lte("scheduled_datetime", new Date(now.getTime() + 48 * 3600e3).toISOString())
      .order("scheduled_datetime", { ascending: true });
    const cands = (candidates ?? []).filter((c: any) => c.status !== "cancelled" && !c.workout_session_id);
    if (!cands.length) return json({ ok: true, skipped: "no candidate sessions" });

    // Conversation context: last 6 text messages with sender roles.
    const { data: msgs } = await supabase
      .from("messages")
      .select("id, sender_id, message, message_type, is_deleted, created_at")
      .eq("conversation_id", conversation_id)
      .eq("message_type", "text")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(6);
    const thread = (msgs ?? []).reverse();
    if (!thread.some((m: any) => m.id === message_id)) return json({ ok: true, skipped: "message not in window" });

    const senderIds = [...new Set(thread.map((m: any) => m.sender_id))];
    const { data: profs } = await supabase.from("profiles").select("id, role").in("id", senderIds);
    const roleOf = (id: string) => (profs ?? []).find((p: any) => p.id === id)?.role ?? "member";

    const { data: client } = await supabase.from("clients").select("first_name, last_name").eq("id", client_id).maybeSingle();
    const clientName = `${client?.first_name ?? ""} ${client?.last_name ?? ""}`.trim() || "the client";

    const candLines = cands.map((c: any) =>
      `- session_id=${c.id} date=${istDate(c.scheduled_datetime)} time=${istClock(c.scheduled_datetime)} modality=${c.modality ?? "?"}`).join("\n");
    const chat = thread.map((m: any) => `[${roleOf(m.sender_id).toUpperCase()}] ${m.message}`).join("\n");

    const prompt = `You detect whether a fitness trainer and client have AGREED to change the time of an upcoming training session, from their chat.

Current IST datetime: ${istDate(now)} ${istClock(now)}
Client: ${clientName}
Upcoming sessions (you may ONLY pick session_id from this list):
${candLines}

Chat (oldest first; Hinglish + English are both common):
${chat}

Rules:
- intent "reschedule" ONLY if the messages clearly agree/propose a NEW time for one of the listed sessions ("c u at 5 pm", "5 baje aa jana", "shift kar do 6 pm").
- Casual time mentions are NOT reschedules ("5 baje uth gaya tha", "3pm session done", "kitne baje hai?").
- new_time must be 24h HH:mm IST. Interpret am/pm and "baje" sensibly for a gym context (7 baje with an evening chat means 19:00 if the session day is today evening).
- Pick the session whose existing time is being replaced (usually the nearest one).
- evidence must be the exact message line you based this on.
- confidence: 0 to 1. Below 0.75 means unsure.
Return JSON only: {"intent":"reschedule"|"none","session_id":"...","new_time":"HH:mm","confidence":0.0,"evidence":"..."}`;

    const out = await callGemini(prompt);
    if (!out || out.intent !== "reschedule") return json({ ok: true, skipped: "no intent", out });
    const conf = Number(out.confidence ?? 0);
    if (!(conf >= 0.75)) return json({ ok: true, skipped: "low confidence", out });
    const cand = cands.find((c: any) => c.id === out.session_id);
    if (!cand) return json({ ok: true, skipped: "session not in candidates", out });
    if (!/^\d{2}:\d{2}$/.test(out.new_time ?? "")) return json({ ok: true, skipped: "bad time", out });

    // v1 rule: SAME IST DAY as the candidate session.
    const day = istDate(cand.scheduled_datetime);
    const proposedIso = new Date(`${day}T${out.new_time}:00+05:30`);
    if (proposedIso.getTime() <= now.getTime()) return json({ ok: true, skipped: "proposed in past", out });
    if (istClock(cand.scheduled_datetime) === out.new_time) return json({ ok: true, skipped: "same time", out });

    // One active suggestion per session: newer replaces older.
    await supabase.from("chat_reschedule_suggestions")
      .update({ status: "expired" })
      .eq("schedule_id", cand.id)
      .eq("status", "pending");
    const { error: insErr } = await supabase.from("chat_reschedule_suggestions").insert({
      conversation_id, message_id,
      trainer_id: cand.trainer_id, client_id, schedule_id: cand.id,
      old_datetime: cand.scheduled_datetime,
      proposed_datetime: proposedIso.toISOString(),
      confidence: conf,
      evidence: String(out.evidence ?? "").slice(0, 300),
    });
    if (insErr) { console.error("insert failed", insErr); return json({ ok: false, error: insErr.message }, 500); }
    return json({ ok: true, suggested: { schedule_id: cand.id, proposed: proposedIso.toISOString(), confidence: conf } });
  } catch (e) {
    console.error("analyze-chat-reschedule error", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
