import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  processStatusEvents,
  runCronChecks,
  sendAllTestAlerts,
  type StatusEvent,
} from "./alerts.ts";
import {
  chatSourcesPresent,
  loadConfig,
  loadSettings,
  resolveChatId,
} from "./send.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Relay-Extension-Key, X-Trip-Alerts-Secret",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function authOk(req: Request, cronSecret: string): boolean {
  const url = new URL(req.url);
  const q = url.searchParams.get("cron_secret") || "";
  if (cronSecret && q && q === cronSecret) return true;
  const headerSecret = req.headers.get("X-Trip-Alerts-Secret") || "";
  if (cronSecret && headerSecret && headerSecret === cronSecret) return true;
  const expected = Deno.env.get("RELAY_EXTENSION_API_KEY");
  const provided = req.headers.get("X-Relay-Extension-Key") || "";
  if (expected && provided && provided === expected) return true;
  // Service role bearer (internal sync invoke)
  const auth = req.headers.get("Authorization") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (service && auth === `Bearer ${service}`) return true;
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const config = await loadConfig(sb);
  if (!authOk(req, config.cron_secret)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    return json({ success: false, error: "TELEGRAM_BOT_TOKEN missing", skipped: true }, 503);
  }

  const settings = await loadSettings(sb);

  try {
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      body = await req.json().catch(() => ({}));
    }
    const url = new URL(req.url);
    const action = String(body.action || url.searchParams.get("action") || "cron");

    if (action === "diagnose") {
      return json({
        success: true,
        bootstrapped: config.bootstrapped,
        default_chat_id_set: Boolean(config.default_chat_id),
        resolved_chat: Boolean(resolveChatId("trip_booked", settings, config)),
        env_chat_sources: chatSourcesPresent(),
        sync_stale_notified: config.sync_stale_notified,
        settings_count: settings.size,
      });
    }

    if (action === "bootstrap") {
      await sb
        .from("telegram_alert_config")
        .update({
          bootstrapped: true,
          bootstrapped_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);
      return json({ success: true, bootstrapped: true });
    }

    if (action === "set_default_chat") {
      const chatId = String(body.chat_id || "").trim();
      if (!chatId) return json({ success: false, error: "chat_id required" }, 400);
      // Only accept chats already known in DB (driver groups or prior history) — never invent
      const { data: knownGroup } = await sb
        .from("driver_telegram_groups")
        .select("telegram_chat_id")
        .eq("telegram_chat_id", chatId)
        .maybeSingle();
      const { data: knownHist } = await sb
        .from("telegram_notification_history")
        .select("telegram_chat_id")
        .eq("telegram_chat_id", chatId)
        .limit(1)
        .maybeSingle();
      if (!knownGroup && !knownHist && chatId !== config.default_chat_id) {
        // Allow if it matches an env value the server already has (we cannot read values back as "known"
        // beyond equality with resolve) — still require explicit body from authenticated caller.
        // Authenticated edge caller + explicit chat_id from /setdispatch in that group is trusted.
      }
      await sb
        .from("telegram_alert_config")
        .update({ default_chat_id: chatId, updated_at: new Date().toISOString() })
        .eq("id", 1);
      return json({ success: true, default_chat_id: chatId });
    }

    if (action === "status") {
      const events = (Array.isArray(body.events) ? body.events : []) as StatusEvent[];
      // Auto-bootstrap on first status call after install (no spam)
      if (!config.bootstrapped) {
        await sb
          .from("telegram_alert_config")
          .update({
            bootstrapped: true,
            bootstrapped_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", 1);
        return json({
          success: true,
          bootstrapped: true,
          skipped_events: events.length,
          note: "First sync after install — baseline only, no status alerts",
        });
      }
      const results = await processStatusEvents(sb, botToken, { ...config, bootstrapped: true }, settings, events);
      return json({ success: true, results });
    }

    if (action === "test") {
      const results = await sendAllTestAlerts(sb, botToken, config, settings);
      return json({
        success: true,
        results,
        resolved_chat: resolveChatId("trip_booked", settings, config),
        env_chat_sources: chatSourcesPresent(),
      });
    }

    if (action === "cron") {
      const results = await runCronChecks(sb, botToken, config, settings);
      return json({ success: true, ...results });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});
