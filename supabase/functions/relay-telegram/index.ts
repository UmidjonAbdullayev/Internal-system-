import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Relay-Extension-Key",
};

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
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!botToken || !chatId) {
    return json({
      success: false,
      error: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured on server",
      skipped: true,
    }, 503);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const body = await req.json();
    const eventType = String(body.event_type || "info");
    const message = String(body.message || "").slice(0, 3500);
    const dedupeKey = String(body.dedupe_key || `${eventType}:${message}`).slice(0, 240);
    if (!message) return json({ success: false, error: "message required" }, 400);

    // Only CRM-relevant event classes
    const allowed = new Set([
      "load_status_change",
      "payment_change",
      "sync_error",
      "missing_page",
    ]);
    if (!allowed.has(eventType)) {
      return json({ success: false, error: `event_type not allowed: ${eventType}` }, 400);
    }

    const { data: existing } = await sb
      .from("relay_notification_dedupe")
      .select("id")
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();
    if (existing) {
      return json({ success: true, deduped: true });
    }

    const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `[Internal Sys Relay]\n${eventType}\n${message}`,
        disable_web_page_preview: true,
      }),
    });
    if (!tg.ok) {
      const errText = await tg.text();
      return json({ success: false, error: errText }, 502);
    }

    await sb.from("relay_notification_dedupe").insert({
      dedupe_key: dedupeKey,
      event_type: eventType,
      payload_summary: message.slice(0, 500),
    });

    return json({ success: true, sent: true });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});
