// ============ notify-client-thread-message ============
// Pushes to every staff member assigned to a client when a new message lands in
// that client's INTERNAL thread (client_thread_messages) — works with the app
// closed. Invoked by a DB trigger (pg_net) on client_thread_messages INSERT
// (see client_thread_push_trigger_migration.sql). Auth = CRON_SECRET header,
// same pattern as notify-longevity-message.
//
// Recipients mirror the thread's access rule (assignment-derived): everyone in
// trainer_clients with actively_training = true for the client, minus the
// sender. Admins can read every thread but are deliberately NOT pushed —
// blanket-notifying admins for every client note would be noise.
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
      .from("client_thread_messages")
      .select("id, thread_id, sender_id, body, attachment_type")
      .eq("id", messageId).maybeSingle();
    if (!msg) return json({ ok: true, skipped: "no message" });

    const { data: thread } = await supabase
      .from("client_threads").select("id, client_id").eq("id", msg.thread_id).maybeSingle();
    if (!thread?.client_id) return json({ ok: true, skipped: "no thread/client" });

    const { data: client } = await supabase
      .from("clients").select("first_name, last_name").eq("id", thread.client_id).maybeSingle();
    const clientName = `${client?.first_name ?? ""} ${client?.last_name ?? ""}`.trim() || "Client";

    // Assigned staff (all roles that reach the thread), minus the sender.
    const { data: assigns } = await supabase
      .from("trainer_clients")
      .select("trainer_id")
      .eq("client_id", thread.client_id)
      .eq("actively_training", true);
    const ids = [...new Set((assigns ?? []).map((a: any) => a.trainer_id))].filter((id) => id && id !== msg.sender_id);
    if (!ids.length) return json({ ok: true, skipped: "no recipients" });

    const { data: sender } = await supabase
      .from("profiles").select("first_name, last_name").eq("id", msg.sender_id).maybeSingle();
    const senderName = `${sender?.first_name ?? ""} ${sender?.last_name ?? ""}`.trim() || "Someone";
    const preview = msg.attachment_type
      ? ({ image: "📷 Photo", voice: "🎤 Voice message", document: "📄 Document" } as Record<string, string>)[msg.attachment_type] ?? "📎 Attachment"
      : String(msg.body ?? "").slice(0, 120);

    let success = 0, failure = 0;
    for (const userId of ids) {
      const r = await pushToStaff({
        supabase,
        userId,
        title: `${clientName} — Client thread`,
        body: `${senderName}: ${preview}`,
        data: { route: "client-threads", type: "client_thread_message", client_id: thread.client_id, thread_id: thread.id },
        channelId: "chat_messages",
      });
      success += r.success; failure += r.failure;
    }
    return json({ ok: true, recipients: ids.length, success, failure });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
