// ============ notify-tech-desk-reminders ============
// CRON (every 15 min): the three Tech Desk nudges that no single event produces.
//
//   R8  Resolved and unacknowledged for 24 h  -> reporter, once per 24 h
//   R9  Waiting on Reporter with no reply for 24 h -> reporter, once per 24 h
//   S7  New ticket nobody on Tech has opened for 30 min (urgent: 10 min)
//                                            -> every tech, once per ticket
//
// Dedupe lives in tech_push_log (kind remind_ack / remind_reply / remind_unopened).
// Auth = CRON_SECRET header; scheduled by pg_cron + pg_net, see
// supabase/tech_desk_push_migration.sql. Deploy with --no-verify-jwt.
import { createClient } from "npm:@supabase/supabase-js@2";
import { pushToStaff } from "../_shared/assistantPush.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const H24 = 24 * 60 * 60_000;
const UNOPENED_MIN = 30;
const UNOPENED_URGENT_MIN = 10;
const CHANNEL = "tech-desk";
const ticketNo = (n: number) => `T${String(n).padStart(3, "0")}`;
const ms = (iso?: string | null) => (iso ? new Date(iso).getTime() || 0 : 0);

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get("CRON_SECRET");
    if (secret && req.headers.get("x-cron-key") !== secret) return json({ ok: false, error: "unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = Date.now();

    // Everything that could need a nudge, in one read.
    const { data: rows } = await supabase
      .from("tech_tickets")
      .select("id, serial_no, title, status, priority, created_by, created_at, timeline")
      .in("status", ["open", "resolved", "waiting_on_reporter"])
      .limit(1000);
    const tickets = (rows ?? []) as any[];
    if (!tickets.length) return json({ ok: true, pushed: 0 });

    // What has already been sent, so reminders never stack.
    const { data: logRows } = await supabase
      .from("tech_push_log").select("recipient, ticket_id, kind, sent_at")
      .in("ticket_id", tickets.map((t) => t.id))
      .like("kind", "remind_%");
    const log = (logRows ?? []) as any[];
    const lastSent = (recipient: string, ticketId: string, kind: string) =>
      Math.max(0, ...log.filter((l) => l.recipient === recipient && l.ticket_id === ticketId && l.kind === kind).map((l) => ms(l.sent_at)));

    let techIds: string[] | null = null;
    const allTech = async () => {
      if (techIds) return techIds;
      const { data } = await supabase.from("profiles").select("id").eq("role", "tech");
      techIds = (data ?? []).map((r: any) => r.id as string);
      return techIds;
    };

    type Push = { userId: string; ticketId: string; kind: string; title: string; body: string; audience: "reporter" | "staff" };
    const pushes: Push[] = [];

    for (const t of tickets) {
      const no = ticketNo(t.serial_no);

      if (t.status === "resolved") {
        // R8: Tech said it is fixed a day ago and nobody answered.
        const resolvedAt = ms(t.timeline?.resolved_at);
        if (t.created_by && resolvedAt && now - resolvedAt > H24 && now - lastSent(t.created_by, t.id, "remind_ack") > H24) {
          pushes.push({ userId: t.created_by, ticketId: t.id, kind: "remind_ack", audience: "reporter",
            title: "Still waiting on you", body: `Confirm the fix on ${no}, or send it back` });
        }
      } else if (t.status === "waiting_on_reporter") {
        // R9: when did Tech ask, and has the reporter written anything since?
        const { data: asked } = await supabase
          .from("tech_ticket_messages").select("created_at")
          .eq("ticket_id", t.id).eq("message->>type", "system").eq("message->>event", "status").eq("message->>to", "waiting_on_reporter")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        const askedAt = ms(asked?.created_at);
        if (!askedAt || now - askedAt < H24) continue;
        const { data: reply } = await supabase
          .from("tech_ticket_messages").select("id")
          .eq("ticket_id", t.id).eq("sender_id", t.created_by).gt("created_at", asked!.created_at)
          .limit(1).maybeSingle();
        if (reply) continue;
        if (t.created_by && now - lastSent(t.created_by, t.id, "remind_reply") > H24) {
          pushes.push({ userId: t.created_by, ticketId: t.id, kind: "remind_reply", audience: "reporter",
            title: "Tech is waiting on you", body: `${no} needs your reply` });
        }
      } else if (t.status === "open" && !t.timeline?.tech_seen_at) {
        // S7: raised, and nobody on the Tech side has opened it. Once per ticket.
        const limitMin = t.priority === "urgent" ? UNOPENED_URGENT_MIN : UNOPENED_MIN;
        const ageMin = Math.floor((now - ms(t.created_at)) / 60_000);
        if (ageMin < limitMin) continue;
        for (const id of await allTech()) {
          if (lastSent(id, t.id, "remind_unopened")) continue;
          pushes.push({ userId: id, ticketId: t.id, kind: "remind_unopened", audience: "staff",
            title: `${t.priority === "urgent" ? "URGENT · " : ""}${no} unopened for ${ageMin}m`, body: t.title });
        }
      }
    }

    let success = 0, failure = 0;
    const sent: { recipient: string; ticket_id: string; kind: string }[] = [];
    for (const x of pushes) {
      const r = await pushToStaff({
        supabase, userId: x.userId, title: x.title, body: x.body, channelId: CHANNEL,
        data: {
          type: "tech_ticket", kind: x.kind, ticket_id: x.ticketId, audience: x.audience,
          collapse_key: `tech-${x.ticketId}`,
          url: x.audience === "staff" ? `/tech?ticket=${x.ticketId}` : `/tech-desk?ticket=${x.ticketId}`,
        },
      });
      success += r.success; failure += r.failure;
      sent.push({ recipient: x.userId, ticket_id: x.ticketId, kind: x.kind });
    }
    if (sent.length) await supabase.from("tech_push_log").insert(sent);

    return json({ ok: true, scanned: tickets.length, pushed: pushes.length, success, failure });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
