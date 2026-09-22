// ============ notify-plan-expiry ============
// CRON, twice a day (10:00 and 19:00 IST): every trainer whose actively-training
// client has an approved workout plan expiring within 3 days gets ONE push that
// lists those clients. Tapping it lands on the trainer's home, where the roster
// cards already carry the amber "N d left" strip for the same plans.
//
// The expiry rule is NOT re-implemented here. plan_expiry_push_rows() in Postgres
// (supabase/plan_expiry_push_migration.sql) mirrors the app's usePlanExpiryMap:
// latest approved plan per client + normalized modality, valid 42 days from
// approved_at, warning when 1..3 days are left. One place to change the rule.
//
// Auth = CRON_SECRET header. Deploy with --no-verify-jwt. Dedupe: one push per
// trainer per slot (YYYY-MM-DD am|pm, IST) in plan_expiry_push_log, so a manual
// re-run of the function never buzzes anyone twice.
import { createClient } from "npm:@supabase/supabase-js@2";
import { pushToStaff } from "../_shared/assistantPush.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const WARN_DAYS = 3;

type Row = { trainer_id: string; client_id: string; client_name: string; modality: string; days_left: number };

const istNow = () => new Date(Date.now() + 5.5 * 3600_000); // wall clock in Asia/Kolkata
const slotKey = () => {
  const d = istNow();
  const ymd = d.toISOString().slice(0, 10);
  return `${ymd}-${d.getUTCHours() < 15 ? "am" : "pm"}`;
};
const dayWord = (n: number) => (n <= 1 ? "tomorrow" : `${n}d`);

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get("CRON_SECRET");
    if (secret && req.headers.get("x-cron-key") !== secret) return json({ ok: false, error: "unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const slot = slotKey();

    const { data, error } = await supabase.rpc("plan_expiry_push_rows", { p_warn_days: WARN_DAYS });
    if (error) return json({ ok: false, error: error.message }, 500);
    const rows = (data ?? []) as Row[];
    if (!rows.length) return json({ ok: true, slot, trainers: 0, pushed: 0 });

    // Group by trainer, most urgent first (the RPC already orders by days_left).
    const byTrainer = new Map<string, Row[]>();
    for (const r of rows) {
      if (!byTrainer.has(r.trainer_id)) byTrainer.set(r.trainer_id, []);
      byTrainer.get(r.trainer_id)!.push(r);
    }

    // Already sent this slot? (manual re-run, overlapping cron)
    const { data: done } = await supabase
      .from("plan_expiry_push_log").select("trainer_id").eq("slot_key", slot)
      .in("trainer_id", [...byTrainer.keys()]);
    const already = new Set((done ?? []).map((x: any) => x.trainer_id as string));

    let pushed = 0, success = 0, failure = 0, skipped = 0;
    const log: { trainer_id: string; slot_key: string; clients: number }[] = [];

    for (const [trainerId, list] of byTrainer) {
      if (already.has(trainerId)) { skipped++; continue; }

      // One line per client; a client with two expiring modalities shows both.
      const byClient = new Map<string, Row[]>();
      for (const r of list) {
        if (!byClient.has(r.client_id)) byClient.set(r.client_id, []);
        byClient.get(r.client_id)!.push(r);
      }
      const lines = [...byClient.values()].map((rs) => {
        const name = rs[0].client_name || "Client";
        const parts = rs.map((r) => `${r.modality} ${dayWord(r.days_left)}`).join(", ");
        return `${name} (${parts})`;
      });
      const n = byClient.size;
      const title = n === 1 ? "1 plan expires soon" : `${n} plans expire soon`;
      const shown = lines.slice(0, 4).join(" · ");
      const body = `${shown}${lines.length > 4 ? ` · +${lines.length - 4} more` : ""}. Make a new plan before they lapse.`;

      const r = await pushToStaff({
        supabase,
        userId: trainerId,
        title,
        body,
        channelId: "default",
        data: { type: "plan_expiry", route: "home", count: String(n), slot },
      });
      success += r.success; failure += r.failure;
      pushed++;
      log.push({ trainer_id: trainerId, slot_key: slot, clients: n });
    }
    if (log.length) await supabase.from("plan_expiry_push_log").upsert(log, { onConflict: "trainer_id,slot_key", ignoreDuplicates: true });

    return json({ ok: true, slot, rows: rows.length, trainers: byTrainer.size, pushed, skipped, success, failure });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
