// ============ notify-tech-desk ============
// One push per Tech Desk event, to the people it concerns, with the app closed.
//
// Every event that matters already writes a row into tech_ticket_messages:
// system/created, system/status, system/assignee, system/type, replies (text and
// file), and the text rows the acknowledge and close-with-reason RPCs post. The
// two silent events (time_taken, delete) are the only ones that do not, and they
// are silent by design. So this is ONE trigger on tech_ticket_messages INSERT,
// invoked via pg_net (see supabase/tech_desk_push_migration.sql), classifying the
// row and fanning out through pushToStaff. Auth = CRON_SECRET header, same as
// notify-client-thread-message.
//
// Cases (numbering matches the design note in docs/features/android/tech/tech-desk.md):
//   Reporter  R1 staff reply   R2 picked up   R3 needs you   R4 fixed? (confirm)
//             R5 closed by Tech   R6 reopened   R7 re-filed
//   Staff     S1 new ticket   S2 reporter reply   S3 assigned to you
//             S4 sent back   S5 confirmed   S6 closed by reporter
//   Reminders (R8, R9, S7) live in notify-tech-desk-reminders.
//
// Rules: never push the actor; admins are not pushed (they keep the badge, like the
// client-thread function); one card per ticket per person (collapse key); a second
// event for the same person + ticket inside 60 s is dropped (tech_push_log).
import { createClient } from "npm:@supabase/supabase-js@2";
import { pushToStaff } from "../_shared/assistantPush.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const SUPPRESS_MS = 60_000;
const CHANNEL = "tech-desk";

const ticketNo = (n: number) => `T${String(n).padStart(3, "0")}`;
const firstName = (p: any) => String(p?.first_name ?? "").trim() || "Tech Desk";
const fullName = (p: any) => `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Someone";
const STATUS_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In Progress", waiting_on_reporter: "Waiting on Reporter",
  testing: "Testing", resolved: "Resolved", closed: "Closed",
};
const TYPE_LABEL: Record<string, string> = { bug: "Bug", feature: "Feature", research: "Research", other: "Other" };

type Push = { userId: string; title: string; body: string; audience: "reporter" | "staff"; kind: string };

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get("CRON_SECRET");
    if (secret && req.headers.get("x-cron-key") !== secret) return json({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const messageId = body?.message_id;
    if (!messageId) return json({ ok: false, error: "message_id required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: msg } = await supabase
      .from("tech_ticket_messages")
      .select("id, ticket_id, sender_id, message, created_at")
      .eq("id", messageId).maybeSingle();
    if (!msg) return json({ ok: true, skipped: "no message" });

    const { data: t } = await supabase
      .from("tech_tickets")
      .select("id, serial_no, title, status, priority, created_by, assigned_to, type, type_label")
      .eq("id", msg.ticket_id).maybeSingle();
    if (!t) return json({ ok: true, skipped: "no ticket" });

    const p = (msg.message ?? {}) as any;
    const sender = msg.sender_id as string | null;
    const senderIsReporter = !!sender && sender === t.created_by;

    // Names and roles. The sender may be NULL for rows written by SQL.
    const ids = [...new Set([sender, t.created_by, t.assigned_to].filter(Boolean))] as string[];
    const { data: profs } = await supabase.from("profiles").select("id, first_name, last_name, role").in("id", ids);
    const prof = (id: string | null) => (profs ?? []).find((x: any) => x.id === id);
    const senderP = prof(sender);
    const creatorP = prof(t.created_by);
    const no = ticketNo(t.serial_no);

    // Staff recipients: the assignee, else every tech. Admins are deliberately not
    // pushed. The default-assignee trigger means new tickets always have one.
    const allTech = async (): Promise<string[]> => {
      const { data } = await supabase.from("profiles").select("id").eq("role", "tech");
      return (data ?? []).map((r: any) => r.id as string);
    };
    const staffTargets = async (): Promise<string[]> => (t.assigned_to ? [t.assigned_to] : await allTech());

    const pushes: Push[] = [];
    const toReporter = (kind: string, title: string, text: string) => {
      if (!t.created_by || t.created_by === sender) return;
      pushes.push({ userId: t.created_by, title, body: text, audience: "reporter", kind });
    };
    const toStaff = async (kind: string, title: string, text: string, only?: string[]) => {
      for (const id of only ?? (await staffTargets())) {
        if (id && id !== sender) pushes.push({ userId: id, title, body: text, audience: "staff", kind });
      }
    };

    const preview = (text: string) => {
      const s = String(text ?? "").replace(/\s+/g, " ").trim();
      return s.length > 100 ? `${s.slice(0, 100)}...` : s;
    };

    if (p.type === "system") {
      if (p.event === "created") {
        // S1: every tech, urgent flagged in the title so it reads at a glance.
        const urgent = t.priority === "urgent";
        await toStaff("new",
          `${urgent ? "URGENT · " : ""}New ticket ${no}`,
          `${fullName(creatorP)} (${String(creatorP?.role ?? "").toUpperCase()}) · ${t.title}`,
          await allTech());
      } else if (p.event === "assignee") {
        // S3: only the person it landed on.
        if (p.to) await toStaff("assigned", `${no} assigned to you`, t.title, [String(p.to)]);
      } else if (p.event === "status") {
        // Status rows written by the REPORTER come from the acknowledge / close RPCs;
        // their text row (below) already carries the push, so these stay quiet.
        if (!senderIsReporter) {
          const to = String(p.to ?? "");
          const from = String(p.from ?? "");
          if (to === "in_progress" && from === "closed") toReporter("reopened", `${no} reopened`, "Tech is looking at this again");
          else if (to === "in_progress") toReporter("picked_up", `${no} picked up`, `${firstName(senderP)} is on it`);
          else if (to === "waiting_on_reporter") toReporter("needs_you", `${no} needs you`, "Tech has a question for you");
          else if (to === "resolved") toReporter("resolved", `${no} fixed?`, `${firstName(senderP)} says it's fixed. Confirm it to close the ticket.`);
          else if (to === "closed") toReporter("closed", `${no} closed`, "Closed by Tech Desk");
          // testing and open: deliberately no push (usually followed within minutes).
        }
      } else if (p.event === "type") {
        // R7: the trigger sends the written label when set, else the enum text.
        const label = TYPE_LABEL[String(p.to)] ?? String(p.to ?? "");
        if (!senderIsReporter && label) toReporter("type", `${no} filed as ${label}`, t.title);
      }
      // priority: no push by design.
    } else if (p.type === "text" || p.type === "file") {
      const text: string = p.type === "file"
        ? (p.file?.kind === "audio" ? "sent a voice memo" : p.text ? preview(p.text) : "sent a file")
        : preview(p.text);
      if (senderIsReporter) {
        // The acknowledge and close-with-reason RPCs post text rows with fixed
        // prefixes. Classify by prefix so staff get the specific card, not "replied".
        const raw = String(p.text ?? "");
        if (raw.startsWith("Not fixed yet.")) {
          await toStaff("sent_back", `${no} sent back`, preview(raw.replace(/^Not fixed yet\.\s*/, "")) || "The reporter says it is not fixed");
        } else if (raw.startsWith("Acknowledged as fixed.")) {
          await toStaff("confirmed", `${no} confirmed`, `${firstName(creatorP)} confirmed the fix, ticket closed`);
        } else if (raw.startsWith("Closed this ticket. Reason:")) {
          await toStaff("closed_by_reporter", `${no} closed by reporter`, preview(raw.replace(/^Closed this ticket\. Reason:\s*/, "")));
        } else {
          await toStaff("reply", `${no} · ${firstName(creatorP)} replied`, text);
        }
      } else if (sender) {
        // R1: staff wrote in the thread.
        toReporter("reply", `${no} · ${firstName(senderP)} replied`, text);
      }
    }

    if (!pushes.length) return json({ ok: true, skipped: "nothing to push", event: p.event ?? p.type });

    // 60 s suppression per recipient + ticket, whatever the kind: a reply that lands
    // seconds after a status move must not buzz twice.
    const since = new Date(Date.now() - SUPPRESS_MS).toISOString();
    const { data: recent } = await supabase
      .from("tech_push_log").select("recipient")
      .eq("ticket_id", t.id).gte("sent_at", since)
      .in("recipient", pushes.map((x) => x.userId));
    const muted = new Set((recent ?? []).map((r: any) => r.recipient as string));

    let success = 0, failure = 0, suppressed = 0;
    const sent: { recipient: string; ticket_id: string; kind: string }[] = [];
    for (const x of pushes) {
      if (muted.has(x.userId)) { suppressed++; continue; }
      const r = await pushToStaff({
        supabase,
        userId: x.userId,
        title: x.title,
        body: x.body,
        channelId: CHANNEL,
        data: {
          type: "tech_ticket",
          kind: x.kind,
          ticket_id: t.id,
          serial_no: String(t.serial_no),
          audience: x.audience,
          // One card per ticket per person: later pushes replace, they do not stack.
          collapse_key: `tech-${t.id}`,
          // The web (Capacitor) app shares odds_device_tokens; it opens this URL.
          url: x.audience === "staff" ? `/tech?ticket=${t.id}` : `/tech-desk?ticket=${t.id}`,
        },
      });
      success += r.success; failure += r.failure;
      sent.push({ recipient: x.userId, ticket_id: t.id, kind: x.kind });
    }
    if (sent.length) await supabase.from("tech_push_log").insert(sent);

    return json({ ok: true, event: p.event ?? p.type, recipients: pushes.length, suppressed, success, failure });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
