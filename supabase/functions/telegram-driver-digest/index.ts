import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Every ~2 hours: post driver status digests to each active linked Telegram group.
 * Invoke via:
 *   - Dashboard cron / external scheduler POST with X-Relay-Extension-Key
 *   - or pg_cron + net.http_post (optional)
 * Includes trailer ID, active loads, and ready/on-time style alert hints.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Relay-Extension-Key",
};

const DIGEST_EVERY_MS = 2 * 60 * 60 * 1000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  const expected = Deno.env.get("RELAY_EXTENSION_API_KEY");
  const provided = req.headers.get("X-Relay-Extension-Key") || "";
  if (!expected || provided !== expected) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    return json({ success: false, error: "TELEGRAM_BOT_TOKEN missing", skipped: true }, 503);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const notifyUrl = `${supabaseUrl}/functions/v1/relay-telegram`;
  const now = Date.now();
  const force = new URL(req.url).searchParams.get("force") === "1";

  const { data: groups, error } = await sb
    .from("driver_telegram_groups")
    .select(
      "id, telegram_chat_id, driver_id, last_status_digest_at, notify_status_digest, notify_alerts, active, bot_can_post",
    )
    .eq("active", true)
    .eq("bot_can_post", true)
    .eq("notify_status_digest", true);

  if (error) return json({ success: false, error: error.message }, 500);

  const results: Array<Record<string, unknown>> = [];

  for (const g of groups || []) {
    const last = g.last_status_digest_at ? new Date(g.last_status_digest_at).getTime() : 0;
    if (!force && last && now - last < DIGEST_EVERY_MS - 60_000) {
      results.push({ chat_id: g.telegram_chat_id, skipped: "not_due" });
      continue;
    }

    const { data: driver } = await sb
      .from("drivers")
      .select("id, driver_id, first_name, last_name, status, trailer_id, assigned_truck")
      .eq("id", g.driver_id)
      .maybeSingle();
    if (!driver) {
      results.push({ chat_id: g.telegram_chat_id, skipped: "driver_missing" });
      continue;
    }

    const { data: loads } = await sb
      .from("loads")
      .select(
        "load_id, load_status, trailer_id, pickup_location, delivery_location, pickup_date, delivery_date",
      )
      .eq("driver_id", driver.id)
      .not("load_status", "in", '("Completed","Cancelled","Rejected")')
      .order("delivery_date", { ascending: true })
      .limit(8);

    const today = new Date().toISOString().slice(0, 10);
    const overdue = (loads || []).filter(
      (l) =>
        l.delivery_date &&
        l.delivery_date < today &&
        !["Delivered", "Completed"].includes(l.load_status),
    );
    const ready = /available|ready/i.test(driver.status || "");

    const lines = [
      `Status digest — ${driver.driver_id} ${driver.first_name} ${driver.last_name}`,
      `Driver status: ${driver.status}`,
      `Truck: ${driver.assigned_truck || "—"} | Trailer: ${driver.trailer_id || "—"}`,
      `Active loads: ${(loads || []).length}`,
    ];
    for (const l of loads || []) {
      lines.push(
        `• ${l.load_id} [${l.load_status}] trailer=${l.trailer_id || driver.trailer_id || "—"} ${l.pickup_location} → ${l.delivery_location} (del ${l.delivery_date})`,
      );
    }
    if (overdue.length && g.notify_alerts) {
      lines.push(`ALERT on-time: ${overdue.length} load(s) past delivery date`);
    }
    if (ready && g.notify_alerts) {
      lines.push("ALERT ready: driver marked Available/Ready");
    }
    // App usage / activity proxy: stale sync on active loads
    const staleLoads = (loads || []).length; // placeholder signal from CRM; detailed Relay app metrics not authorizedly available
    if (staleLoads === 0 && !ready && g.notify_alerts) {
      lines.push("ALERT activity: no active loads while not Available — check app/dispatch");
    }

    const message = lines.join("\n");
    const dedupeKey = `status_digest:${driver.id}:${new Date().toISOString().slice(0, 13)}`;

    const res = await fetch(notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || serviceKey}`,
        apikey: Deno.env.get("SUPABASE_ANON_KEY") || serviceKey,
        "X-Relay-Extension-Key": expected,
      },
      body: JSON.stringify({
        event_type: "status_digest",
        driver_id: driver.id,
        trailer_id: driver.trailer_id,
        dedupe_key: dedupeKey,
        message,
      }),
    });
    const body = await res.json().catch(() => ({}));

    await sb
      .from("driver_telegram_groups")
      .update({
        last_status_digest_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", g.id);

    results.push({ chat_id: g.telegram_chat_id, ok: res.ok, body });
  }

  return json({ success: true, processed: results.length, results });
});
