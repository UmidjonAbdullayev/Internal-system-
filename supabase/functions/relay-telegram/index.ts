import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * Routes CRM/Relay alerts to the correct Telegram group (one group = one driver).
 * Groups only receive facility-arrival (dark-blue status bar) alerts — no payments,
 * digests, trailer, or generic status spam.
 * TELEGRAM_BOT_TOKEN is read from Edge Function secrets only.
 * Optional TELEGRAM_OPS_CHAT_ID for global ops alerts (sync_error / missing_page).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Relay-Extension-Key",
};

/** Driver-group push events (facility arrival only). */
const DRIVER_EVENTS = new Set(["facility_arrived"]);

const OPS_EVENTS = new Set(["sync_error", "missing_page"]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function authOk(req: Request): boolean {
  const expected = Deno.env.get("RELAY_EXTENSION_API_KEY");
  const provided = req.headers.get("X-Relay-Extension-Key") || "";
  return Boolean(expected && provided && provided === expected);
}

/** Env TELEGRAM_ALERTS_ENABLED default OFF — hard check before every automatic send. */
function isTelegramAlertsEnabled(): boolean {
  const v = (Deno.env.get("TELEGRAM_ALERTS_ENABLED") || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  if (!isTelegramAlertsEnabled()) {
    return { ok: false, skipped: true, error: "TELEGRAM_ALERTS_ENABLED is OFF" };
  }
  try {
    const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 3900),
        disable_web_page_preview: true,
      }),
    });
    if (!tg.ok) {
      const errText = await tg.text();
      return { ok: false, error: errText };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function recordHistory(
  sb: SupabaseClient,
  row: {
    telegram_chat_id: string | null;
    driver_id: string | null;
    event_type: string;
    dedupe_key: string;
    message: string;
    status: "sent" | "deduped" | "failed" | "skipped";
    error?: string | null;
    meta?: Record<string, unknown>;
  },
) {
  await sb.from("telegram_notification_history").insert({
    telegram_chat_id: row.telegram_chat_id,
    driver_id: row.driver_id,
    event_type: row.event_type,
    dedupe_key: row.dedupe_key,
    message: row.message,
    status: row.status,
    error: row.error ?? null,
    meta: row.meta ?? {},
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }
  if (!authOk(req)) return json({ success: false, error: "Unauthorized" }, 401);

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    return json({
      success: false,
      error: "TELEGRAM_BOT_TOKEN not configured on server",
      skipped: true,
    }, 503);
  }

  const opsChatId = Deno.env.get("TELEGRAM_OPS_CHAT_ID") || Deno.env.get("TELEGRAM_CHAT_ID") || null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const body = await req.json();
    const eventType = String(body.event_type || "info");
    const message = String(body.message || "").slice(0, 3500);
    const driverId = body.driver_id ? String(body.driver_id) : null;
    const trailerId = body.trailer_id ? String(body.trailer_id) : null;
    const tractorId = body.tractor_id ? String(body.tractor_id) : null;
    const loadId = body.load_id ? String(body.load_id) : null;
    const baseDedupe = String(body.dedupe_key || `${eventType}:${message}`).slice(0, 200);

    if (!message) return json({ success: false, error: "message required" }, 400);

    // Drop payment / digest / generic status pushes (defense in depth).
    if (
      eventType === "payment_change" ||
      eventType === "status_digest" ||
      eventType === "trailer_change" ||
      eventType === "load_status_change" ||
      eventType === "loaded_enroute" ||
      eventType === "dispatch_update" ||
      eventType === "driver_status" ||
      eventType.startsWith("alert_")
    ) {
      await recordHistory(sb, {
        telegram_chat_id: null,
        driver_id: driverId,
        event_type: eventType,
        dedupe_key: baseDedupe,
        message,
        status: "skipped",
        error: "Group notifies are facility_arrived only; payments/menus stripped",
      });
      return json({ success: true, skipped: true, reason: "facility_arrival_only" });
    }

    if (!DRIVER_EVENTS.has(eventType) && !OPS_EVENTS.has(eventType)) {
      return json({ success: false, error: `event_type not allowed: ${eventType}` }, 400);
    }

    const textParts = [`[Internal Sys Relay]`, "Facility arrival"];
    if (loadId) textParts.push(`Load: ${loadId}`);
    if (trailerId) textParts.push(`Trailer: ${trailerId}`);
    if (tractorId) textParts.push(`Tractor: ${tractorId}`);
    textParts.push(message);
    const text = eventType === "facility_arrived"
      ? textParts.join("\n")
      : [`[Internal Sys Relay]`, eventType, message].join("\n");

    type Target = { chat_id: string; driver_id: string | null; group_id?: string };
    const targets: Target[] = [];

    if (OPS_EVENTS.has(eventType)) {
      if (opsChatId) targets.push({ chat_id: opsChatId, driver_id: null });
      else {
        await recordHistory(sb, {
          telegram_chat_id: null,
          driver_id: null,
          event_type: eventType,
          dedupe_key: baseDedupe,
          message,
          status: "skipped",
          error: "No TELEGRAM_OPS_CHAT_ID / TELEGRAM_CHAT_ID configured for ops events",
        });
        return json({ success: true, skipped: true, reason: "no_ops_chat" });
      }
    } else {
      if (!driverId) {
        return json({
          success: false,
          error: "driver_id required for driver-scoped Telegram events",
        }, 400);
      }
      const { data: groups, error } = await sb
        .from("driver_telegram_groups")
        .select(
          "id, telegram_chat_id, driver_id, active, bot_can_post, notify_dispatch, notify_alerts",
        )
        .eq("driver_id", driverId)
        .eq("active", true);
      if (error) return json({ success: false, error: error.message }, 500);
      for (const g of groups || []) {
        if (!g.bot_can_post) continue;
        // Facility arrival uses dispatch/alerts toggles (either enables).
        if (g.notify_dispatch === false && g.notify_alerts === false) continue;
        targets.push({
          chat_id: g.telegram_chat_id,
          driver_id: g.driver_id,
          group_id: g.id,
        });
      }
      if (!targets.length) {
        await recordHistory(sb, {
          telegram_chat_id: null,
          driver_id: driverId,
          event_type: eventType,
          dedupe_key: baseDedupe,
          message,
          status: "skipped",
          error: "No active Telegram group linked for driver",
        });
        return json({ success: true, skipped: true, reason: "no_driver_group" });
      }
    }

    const results: Array<Record<string, unknown>> = [];
    for (const t of targets) {
      const dedupeKey = `${baseDedupe}:chat:${t.chat_id}`.slice(0, 240);
      const { data: existing } = await sb
        .from("relay_notification_dedupe")
        .select("id")
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();
      if (existing) {
        await recordHistory(sb, {
          telegram_chat_id: t.chat_id,
          driver_id: t.driver_id,
          event_type: eventType,
          dedupe_key: dedupeKey,
          message: text,
          status: "deduped",
        });
        results.push({ chat_id: t.chat_id, deduped: true });
        continue;
      }

      const sent = await sendTelegram(botToken, t.chat_id, text);
      if (!sent.ok) {
        await recordHistory(sb, {
          telegram_chat_id: t.chat_id,
          driver_id: t.driver_id,
          event_type: eventType,
          dedupe_key: dedupeKey,
          message: text,
          status: "failed",
          error: sent.error,
        });
        if (t.group_id) {
          await sb
            .from("driver_telegram_groups")
            .update({
              last_error: sent.error?.slice(0, 500) ?? "send failed",
              last_error_at: new Date().toISOString(),
              bot_can_post: !/forbidden|bot was kicked|chat not found/i.test(sent.error || ""),
              updated_at: new Date().toISOString(),
            })
            .eq("id", t.group_id);
        }
        results.push({ chat_id: t.chat_id, ok: false, error: sent.error });
        continue;
      }

      await sb.from("relay_notification_dedupe").insert({
        dedupe_key: dedupeKey,
        event_type: eventType,
        payload_summary: text.slice(0, 500),
        telegram_chat_id: t.chat_id,
        driver_id: t.driver_id,
      });
      await recordHistory(sb, {
        telegram_chat_id: t.chat_id,
        driver_id: t.driver_id,
        event_type: eventType,
        dedupe_key: dedupeKey,
        message: text,
        status: "sent",
        meta: { load_id: loadId, trailer_id: trailerId, tractor_id: tractorId },
      });
      if (t.group_id) {
        await sb
          .from("driver_telegram_groups")
          .update({
            last_error: null,
            last_error_at: null,
            bot_can_post: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", t.group_id);
      }
      results.push({ chat_id: t.chat_id, ok: true });
    }

    return json({ success: true, results });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});
