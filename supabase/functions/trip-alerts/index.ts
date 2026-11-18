import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  processStatusEvents,
  runCronChecks,
  runDryRunWindow,
  sendAllTestAlerts,
  sendReplayArrivedAlerts,
  type StatusEvent,
} from "./alerts.ts";
import {
  chatSourcesPresent,
  isTelegramAlertsEnabled,
  loadConfig,
  loadSettings,
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
        rebuild: "arrived_not_at_stop_only",
        bootstrapped: config.bootstrapped,
        alerts_enabled_db: config.alerts_enabled,
        kill_switch: isTelegramAlertsEnabled(config),
        env_chat_sources: chatSourcesPresent(),
        settings: Object.fromEntries(
          [...settings.entries()].map(([k, v]) => [k, { enabled: v.enabled }]),
        ),
        note: "TELEGRAM_ALERTS_ENABLED stays OFF until user approves step 6",
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

    if (action === "dry_run") {
      const hours = Number(body.window_hours || url.searchParams.get("window_hours") || 1);
      // Fresh window only — never accumulate / never seed
      await sb.from("dry_run_alerts").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      const out = await runDryRunWindow(sb, botToken, config, settings, hours);
      const { data: preview, count } = await sb
        .from("dry_run_alerts")
        .select(
          "id, trip_id, stop_id, alert_type, chat_id, driver_id, reason, sync_basis, would_send_at, html, meta",
          { count: "exact" },
        )
        .order("would_send_at", { ascending: false })
        .limit(200);
      const grouped: Record<string, number> = {};
      for (const row of preview || []) {
        const key = `${row.trip_id}|${row.stop_id}|${row.alert_type}|${row.chat_id || "(none)"}`;
        grouped[key] = (grouped[key] || 0) + 1;
      }
      const dupes = Object.entries(grouped).filter(([, n]) => n > 1);
      return json({
        success: true,
        dry_run: true,
        kill_switch: isTelegramAlertsEnabled(config),
        window_hours: hours,
        evaluated: out.count,
        preview_count: count,
        unique_keys: Object.keys(grouped).length,
        duplicate_keys: dupes.length,
        preview: preview || [],
        results: out.results,
        note: "No Telegram messages sent. Table cleared then rebuilt from live 1h window. Never seed prod.",
      });
    }

    if (action === "status") {
      const events = (Array.isArray(body.events) ? body.events : []) as StatusEvent[];
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
      // Kill switch OFF: do not accumulate dry_run on every sync (explicit dry_run only)
      if (!isTelegramAlertsEnabled(config)) {
        return json({
          success: true,
          skipped: true,
          reason: "kill_switch_off",
          events_seen: events.length,
          kill_switch: false,
          note: "Status edges ignored for send/dry_run while OFF. Use action=dry_run.",
        });
      }
      const results = await processStatusEvents(sb, botToken, config, settings, events, {
        dryRun: false,
      });
      return json({
        success: true,
        results,
        kill_switch: true,
      });
    }

    if (action === "test") {
      const chatId = String(body.chat_id || "").trim();
      if (!chatId) {
        return json({ success: false, error: "chat_id required for /test" }, 400);
      }
      const results = await sendAllTestAlerts(sb, botToken, config, settings, {
        chatIds: [chatId],
      });
      return json({
        success: true,
        results,
        chat_id: chatId,
        kill_switch: isTelegramAlertsEnabled(config),
        note: "TEST samples only; kill switch stays OFF until you enable TELEGRAM_ALERTS_ENABLED",
      });
    }

    // Manual TEST REPLAY — one chat only; never resolves real driver_groups.
    if (action === "replay") {
      const chatId = String(body.chat_id || "").trim();
      const stopIds = Array.isArray(body.stop_ids)
        ? body.stop_ids.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      if (!chatId) {
        return json({ success: false, error: "chat_id required for replay" }, 400);
      }
      if (!stopIds.length) {
        return json({ success: false, error: "stop_ids required for replay" }, 400);
      }
      const results = await sendReplayArrivedAlerts(sb, botToken, config, settings, {
        chatId,
        stopIds,
      });
      return json({
        success: true,
        replay: true,
        chat_id: chatId,
        stop_ids: stopIds,
        results,
        kill_switch: isTelegramAlertsEnabled(config),
        note: "TEST REPLAY ARRIVED only to chat_id; real driver groups untouched",
      });
    }

    if (action === "cron") {
      // Kill switch OFF → no send and no dry_run spam (use action=dry_run for preview)
      if (!isTelegramAlertsEnabled(config)) {
        return json({
          success: true,
          skipped: true,
          reason: "kill_switch_off",
          kill_switch: false,
          note: "Cron idle while OFF. Run action=dry_run for a fresh 1h preview.",
        });
      }
      const results = await runCronChecks(sb, botToken, config, settings, {
        dryRun: false,
      });
      return json({
        success: true,
        ...results,
        kill_switch: true,
      });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});
