// ============ notify-longevity-message ============
// Pushes to every CRM in a client's care-team GROUP when a new message lands —
// the B2C "reply within 2 minutes" commitment, working with the app CLOSED.
// Invoked by a DB trigger (pg_net) on messages INSERT (see
// longevity_push_trigger_migration.sql). Auth = CRON_SECRET header, same
// pattern as notify-far-sessions. The push targets the 'longevity-alerts'
// Android channel, whose ~30s vibration pattern lives on the device.
import { createClient } from "npm:@supabase/supabase-js@2";
import { pushToStaff } from "../_shared/assistantPush.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get("CRON_SECRET");
    if (secret && req.headers.get("x-cron-key") !== secret) return json({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const messageId = body?.message_id;
    if (!messageId) return json({ ok: false, error: "message_id required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: msg } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_id, message, message_type, is_deleted")
      .eq("id", messageId).maybeSingle();
    if (!msg || msg.is_deleted) return json({ ok: true, skipped: "no message" });

    // Care-team group only (any type='group' except the announcements broadcast).
    const { data: conv } = await supabase
      .from("conversations").select("id, type, name").eq("id", msg.conversation_id).maybeSingle();
    if (!conv || conv.type !== "group" || conv.name === "Odds Announcements") {
      return json({ ok: true, skipped: "not a care-team group" });
    }

    // Recipients: active CRM participants, excluding the sender.
    const { data: parts } = await supabase
      .from("conversation_participants")
      .select("user_id").eq("conversation_id", conv.id).eq("is_active", true);
    const ids = [...new Set((parts ?? []).map((p: any) => p.user_id))].filter((id) => id !== msg.sender_id);
    if (!ids.length) return json({ ok: true, skipped: "no participants" });
    const { data: profs } = await supabase
      .from("profiles").select("id, first_name, last_name, role").in("id", ids);
    const crmIds = (profs ?? []).filter((p: any) => p.role === "crm").map((p: any) => p.id);
    if (!crmIds.length) return json({ ok: true, skipped: "no crm participants" });

    // Sender name + preview for the notification body.
    const { data: sender } = await supabase
      .from("profiles").select("first_name, last_name").eq("id", msg.sender_id).maybeSingle();
    const senderName = `${sender?.first_name ?? ""} ${sender?.last_name ?? ""}`.trim() || "Someone";
    const preview = msg.message_type && msg.message_type !== "text"
      ? ({ image: "📷 Photo", video: "🎥 Video", voice: "🎤 Voice message", document: "📄 Document" } as Record<string, string>)[msg.message_type] ?? "New message"
      : String(msg.message ?? "").slice(0, 120);

    let success = 0, failure = 0;
    for (const crmId of crmIds) {
      const r = await pushToStaff({
        supabase,
        userId: crmId,
        title: "⏱ Longevity Team — reply needed",
        body: `${senderName}: ${preview}`,
        data: { route: "/crm", type: "longevity_message", conversation_id: conv.id },
        channelId: "longevity-alerts",
      });
      success += r.success; failure += r.failure;
    }
    return json({ ok: true, crms: crmIds.length, success, failure });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
