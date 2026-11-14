import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Telegram Bot webhook for per-driver groups.
 * - Auto-processes /link DRV-xxxx and /status in the group
 * - Associates telegram chat_id ↔ drivers.driver_id without code changes
 * Auth: Telegram secret token header OR ?secret= query matching TELEGRAM_WEBHOOK_SECRET
 * TELEGRAM_BOT_TOKEN from secrets only.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function reply(botToken: string, chatId: number | string, text: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 3900),
      disable_web_page_preview: true,
    }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (webhookSecret) {
    const header = req.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    const q = new URL(req.url).searchParams.get("secret") || "";
    if (header !== webhookSecret && q !== webhookSecret) {
      return json({ success: false, error: "Unauthorized webhook" }, 401);
    }
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) return json({ success: false, error: "TELEGRAM_BOT_TOKEN missing" }, 503);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const update = await req.json();
    const msg = update.message || update.edited_message || update.channel_post;
    if (!msg?.chat?.id) return json({ success: true, ignored: true });

    const chatId = String(msg.chat.id);
    const chatTitle = msg.chat.title || msg.chat.username || null;
    const text = String(msg.text || msg.caption || "").trim();
    if (!text) return json({ success: true, ignored: true });

    // /link DRV-1024  — associate this group with a CRM driver (no code deploy)
    const link = text.match(/^\/link(?:@\w+)?\s+(\S+)/i);
    if (link) {
      const driverCode = link[1].trim();
      const { data: driver } = await sb
        .from("drivers")
        .select("id, driver_id, first_name, last_name, status, trailer_id, assigned_truck")
        .eq("driver_id", driverCode)
        .maybeSingle();
      if (!driver) {
        await reply(botToken, chatId, `No CRM driver found for code \`${driverCode}\`.`);
        return json({ success: true, linked: false });
      }

      const { error } = await sb.from("driver_telegram_groups").upsert(
        {
          telegram_chat_id: chatId,
          driver_id: driver.id,
          group_title: chatTitle,
          active: true,
          bot_can_post: true,
          last_error: null,
          last_error_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "telegram_chat_id" },
      );
      if (error) {
        await reply(botToken, chatId, `Link failed: ${error.message}`);
        return json({ success: false, error: error.message }, 500);
      }
      await reply(
        botToken,
        chatId,
        `Linked this group to driver ${driver.driver_id} (${driver.first_name} ${driver.last_name}).\nAlerts for this driver will post here only.`,
      );
      return json({ success: true, linked: true, driver_id: driver.id });
    }

    if (/^\/unlink(?:@\w+)?$/i.test(text)) {
      await sb
        .from("driver_telegram_groups")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("telegram_chat_id", chatId);
      await reply(botToken, chatId, "Group unlinked (set inactive). Use /link DRV-xxxx to re-link.");
      return json({ success: true, unlinked: true });
    }

    if (/^\/status(?:@\w+)?$/i.test(text)) {
      const { data: group } = await sb
        .from("driver_telegram_groups")
        .select("driver_id, active")
        .eq("telegram_chat_id", chatId)
        .maybeSingle();
      if (!group?.driver_id || !group.active) {
        await reply(botToken, chatId, "This group is not linked. Use /link DRV-xxxx");
        return json({ success: true });
      }
      const { data: driver } = await sb
        .from("drivers")
        .select("driver_id, first_name, last_name, status, trailer_id, assigned_truck")
        .eq("id", group.driver_id)
        .maybeSingle();
      const { data: loads } = await sb
        .from("loads")
        .select("load_id, load_status, trailer_id, pickup_location, delivery_location, delivery_date")
        .eq("driver_id", group.driver_id)
        .not("load_status", "in", '("Completed","Cancelled","Rejected")')
        .order("delivery_date", { ascending: true })
        .limit(5);

      const lines = [
        `Driver: ${driver?.driver_id} ${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim(),
        `Status: ${driver?.status ?? "—"}`,
        `Truck: ${driver?.assigned_truck || "—"}`,
        `Trailer: ${driver?.trailer_id || "—"}`,
        `Active loads: ${(loads || []).length}`,
      ];
      for (const l of loads || []) {
        lines.push(
          `• ${l.load_id} [${l.load_status}] trailer=${l.trailer_id || "—"} ${l.pickup_location} → ${l.delivery_location}`,
        );
      }
      await reply(botToken, chatId, lines.join("\n"));
      return json({ success: true, status: true });
    }

    if (/^\/help(?:@\w+)?$/i.test(text)) {
      await reply(
        botToken,
        chatId,
        [
          "Amazon Relay Intelligence — driver group commands:",
          "/link DRV-xxxx — associate this group with a CRM driver",
          "/unlink — deactivate this group link",
          "/status — current driver + active loads (incl. trailer)",
          "/help — this message",
        ].join("\n"),
      );
      return json({ success: true });
    }

    // Ensure we know this chat exists; refresh title if linked
    await sb
      .from("driver_telegram_groups")
      .update({
        group_title: chatTitle,
        updated_at: new Date().toISOString(),
        bot_can_post: true,
        last_error: null,
      })
      .eq("telegram_chat_id", chatId);

    return json({ success: true, processed: false });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});
