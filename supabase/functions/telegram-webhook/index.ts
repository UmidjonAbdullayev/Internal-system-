import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  corsHeaders,
  json,
  ensureBotMenu,
  isGroupChat,
  isPrivateChat,
  reply,
  getSession,
  askPasswordOnceText,
  touchSession,
  mainMenuKeyboard,
  helpText,
  tryAuthPassword,
  trySelectDriver,
  requirePrivateAdmin,
  buildStatusText,
  buildUpdatesText,
  buildTourText,
  handleCallback,
  buildTripStatusById,
  crmBaseUrl,
  openCrmMarkup,
  listCrmDriversForLink,
  linkDriverKeyboard,
  linkDriverGroup,
  deleteMessage,
  isTelegramGroupAdmin,
} from "./helpers.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

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

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    await ensureBotMenu(botToken);
    const update = await req.json();
    if (update.callback_query) {
      await handleCallback(botToken, sb, update.callback_query);
      return json({ success: true, callback: true });
    }
    const msg = update.message || update.edited_message || update.channel_post;
    if (!msg?.chat?.id) return json({ success: true, ignored: true });
    const chat = msg.chat;
    const chatId = String(chat.id);
    const chatTitle = chat.title || chat.username || null;
    const userId = msg.from?.id != null ? Number(msg.from.id) : null;
    const text = String(msg.text || msg.caption || "").trim();
    if (!text) return json({ success: true, ignored: true });
    const cmd = text.split(/\s+/)[0] || "";
    const cmdBase = cmd.replace(/@\w+$/i, "").toLowerCase();

    if (isGroupChat(chat)) {
      // /setupdates — make THIS group the shared "Driver Updates" group for ALL drivers.
      // Only a Telegram admin/creator of this group can do it.
      if (cmdBase === "/setupdates" || cmdBase === "/updatesoff") {
        const isAdmin = userId != null && (await isTelegramGroupAdmin(botToken, chatId, userId));
        if (!isAdmin) {
          await reply(botToken, chatId, "Only an admin of this Telegram group can change where alerts go.");
          return json({ success: true, set: false, reason: "not_group_admin" });
        }
        const now = new Date().toISOString();
        if (cmdBase === "/setupdates") {
          const { error } = await sb
            .from("telegram_alert_config")
            .update({
              routing_mode: "broadcast",
              broadcast_chat_id: chatId,
              broadcast_title: chatTitle,
              broadcast_set_by: String(userId),
              broadcast_set_at: now,
              updated_at: now,
            })
            .eq("id", 1);
          if (error) {
            await reply(botToken, chatId, `Could not set: ${error.message}`);
            return json({ success: false, error: error.message }, 500);
          }
          await reply(
            botToken,
            chatId,
            "✅ This group is now <b>Driver Updates</b>.\nARRIVED and NOT AT STOP alerts for <b>all drivers</b> come here. Per-driver groups get nothing.\n/test · /updatesoff",
            undefined,
            "HTML",
          );
          return json({ success: true, broadcast: chatId });
        }
        await sb
          .from("telegram_alert_config")
          .update({ routing_mode: "driver_groups", updated_at: now })
          .eq("id", 1);
        await reply(botToken, chatId, "Driver Updates turned off. Alerts go back to per-driver linked groups.");
        return json({ success: true, broadcast: null });
      }
      // /link — CRM driver buttons (name + DRV id)
      if (cmdBase === "/link") {
        const arg = text.replace(/^\/link(?:@\w+)?\s*/i, "").trim();
        if (arg) {
          const code = /^DRV-/i.test(arg) ? arg.toUpperCase() : arg;
          const { data: crm } = await sb
            .from("drivers")
            .select("first_name, last_name, driver_id")
            .eq("driver_id", code)
            .maybeSingle();
          if (!crm) {
            const drivers = await listCrmDriversForLink(sb, { limit: 20, search: arg });
            await reply(
              botToken,
              chatId,
              `No exact match for ${arg}. Pick from the list:`,
              linkDriverKeyboard(drivers, { page: 0 }),
            );
            return json({ success: true, linked: false, need_pick: true });
          }
          const driverName = `${crm.first_name} ${crm.last_name}`.trim();
          const { error } = await linkDriverGroup(
            sb,
            chatId,
            crm.driver_id,
            chatTitle,
            userId != null ? String(userId) : null,
            driverName,
            null,
          );
          if (error) {
            await reply(botToken, chatId, `Link failed: ${error.message}`);
            return json({ success: false, error: error.message }, 500);
          }
          await reply(
            botToken,
            chatId,
            `Linked to ${driverName} (${crm.driver_id}).\n/whoami · /test · /unlink · /mute`,
          );
          return json({ success: true, linked: true, driver_id: crm.driver_id });
        }
        const drivers = await listCrmDriversForLink(sb, { limit: 20, offset: 0 });
        await reply(
          botToken,
          chatId,
          "Pick a CRM driver to link this group. Only that driver's ARRIVED / NOT AT STOP alerts go here.",
          linkDriverKeyboard(drivers, { page: 0 }),
        );
        return json({ success: true, link_menu: true });
      }
      if (cmdBase === "/unlink") {
        await sb
          .from("driver_groups")
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq("chat_id", chatId);
        // Keep legacy table in sync when present
        await sb
          .from("driver_telegram_groups")
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq("telegram_chat_id", chatId);
        await reply(botToken, chatId, "Group unlinked. /link to re-link.");
        return json({ success: true, unlinked: true });
      }
      if (cmdBase === "/whoami") {
        const { data: cfg } = await sb
          .from("telegram_alert_config")
          .select("routing_mode, broadcast_chat_id")
          .eq("id", 1)
          .maybeSingle();
        if (cfg?.routing_mode === "broadcast" && String(cfg.broadcast_chat_id || "") === chatId) {
          await reply(botToken, chatId, "This group is <b>Driver Updates</b>: alerts for all drivers.", undefined, "HTML");
          return json({ success: true, whoami: "broadcast" });
        }
        const { data: g } = await sb
          .from("driver_groups")
          .select("driver_id, relay_driver_id, driver_name, active, group_title, alerts_enabled, quiet")
          .eq("chat_id", chatId)
          .maybeSingle();
        if (!g || !g.active) {
          await reply(botToken, chatId, "Not linked. Use /link to choose a CRM driver.");
          return json({ success: true, whoami: false });
        }
        await reply(
          botToken,
          chatId,
          `This group → <b>${g.driver_name || "driver"}</b>\n<code>${g.driver_id || g.relay_driver_id}</code>\nGroup alerts: ${g.alerts_enabled ? "enabled" : "OFF (pilot)"}${g.quiet ? " · muted" : ""}`,
          undefined,
          "HTML",
        );
        return json({ success: true, whoami: true, driver_id: g.driver_id });
      }
      if (cmdBase === "/test") {
        const { data: g } = await sb
          .from("driver_groups")
          .select("relay_driver_id, active")
          .eq("chat_id", chatId)
          .maybeSingle();
        const { data: bc } = await sb
          .from("telegram_alert_config")
          .select("broadcast_chat_id")
          .eq("id", 1)
          .maybeSingle();
        const isBroadcast = String(bc?.broadcast_chat_id || "") === chatId;
        if (!g?.active && !isBroadcast) {
          await reply(botToken, chatId, "Link this group with /link before /test.");
          return json({ success: true, test: false });
        }
        // Invoke trip-alerts test for THIS chat only (force bypasses kill switch)
        const projectUrl = Deno.env.get("SUPABASE_URL")!;
        const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const res = await fetch(`${projectUrl}/functions/v1/trip-alerts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${service}`,
          },
          body: JSON.stringify({ action: "test", chat_id: chatId }),
        });
        const body = await res.json().catch(() => ({}));
        await reply(
          botToken,
          chatId,
          res.ok
            ? "[TEST] samples sent to this group only."
            : `Test failed: ${JSON.stringify(body).slice(0, 400)}`,
        );
        return json({ success: res.ok, test: true, body });
      }
      // Per-group quiet toggle (rebuild)
      if (cmdBase === "/mute") {
        await sb
          .from("driver_groups")
          .update({ quiet: true, updated_at: new Date().toISOString() })
          .eq("chat_id", chatId);
        await reply(botToken, chatId, "This group is muted. /unmute to resume alerts.");
        return json({ success: true, mute: true });
      }
      if (cmdBase === "/unmute") {
        await sb
          .from("driver_groups")
          .update({ quiet: false, updated_at: new Date().toISOString() })
          .eq("chat_id", chatId);
        await reply(botToken, chatId, "Group unmuted.");
        return json({ success: true, unmute: true });
      }
      if (cmdBase === "/status") {
        const m = text.match(/^\/status(?:@\w+)?\s+(\S+)/i);
        if (!m) {
          await reply(
            botToken,
            chatId,
            "In groups use /status <tripId>. Full menus are DM-only with @inter_sysbot.",
          );
          return json({ success: true, redirected: "need_trip" });
        }
        const body = await buildTripStatusById(sb, m[1]);
        const base = await crmBaseUrl(sb);
        await reply(botToken, chatId, body, openCrmMarkup(base, m[1].trim().toUpperCase()));
        return json({ success: true, status: true, trip: true });
      }
      if (["/menu", "/start", "/updates", "/tour", "/loads", "/help", "/late", "/setdispatch"].includes(cmdBase)) {
        await reply(
          botToken,
          chatId,
          "Menus are disabled in groups. Open a private chat with @inter_sysbot, unlock with the CRM bot password.\nGroup cmds: /setupdates /updatesoff /whoami /test /status <tripId> (driver groups: /link /unlink /mute /unmute)",
        );
        return json({ success: true, redirected: "dm_only" });
      }
      return json({ success: true, processed: false, group: true });
    }

    if (!isPrivateChat(chat) || userId == null) return json({ success: true, ignored: true });

    if (cmdBase === "/logout") {
      await sb.from("telegram_admin_sessions").delete().eq("telegram_user_id", userId);
      await sb
        .from("bot_users")
        .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("telegram_user_id", userId);
      await reply(botToken, chatId, "Access revoked. Send the bot password to unlock again.");
      return json({ success: true, logout: true });
    }
    if (cmdBase === "/help") {
      const session = await getSession(sb, userId);
      await reply(botToken, chatId, helpText(session), session ? mainMenuKeyboard() : undefined);
      return json({ success: true });
    }
    if (cmdBase === "/start") {
      const session = await getSession(sb, userId);
      if (!session) {
        await reply(botToken, chatId, askPasswordOnceText());
        return json({ success: true, start: true, locked: true });
      }
      await touchSession(sb, userId);
      if (!session.selected_driver_id) {
        await reply(
          botToken,
          chatId,
          "Unlocked. Send DRV-xxxx (or /driver DRV-xxxx) to look up a driver, or open /menu.",
          mainMenuKeyboard(),
        );
        return json({ success: true, start: true, unlocked: true });
      }
      await reply(
        botToken,
        chatId,
        `Welcome back — still unlocked. Menu for ${session.selected_driver_code}:`,
        mainMenuKeyboard(),
      );
      return json({ success: true, start: true, menu: true });
    }

    const authAttempt = await tryAuthPassword(botToken, sb, chatId, userId, text);
    if (authAttempt === "ok") {
      if (msg.message_id != null) await deleteMessage(botToken, chatId, Number(msg.message_id));
      return json({ success: true, authenticated: true });
    }
    if (authAttempt === "unset") {
      await reply(
        botToken,
        chatId,
        "Bot password is not set. Set it in CRM Settings (Telegram bot password).",
      );
      return json({ success: true, authenticated: false, reason: "password_unset" });
    }
    if (authAttempt === "wrong") {
      if (msg.message_id != null) await deleteMessage(botToken, chatId, Number(msg.message_id));
      await reply(botToken, chatId, "Wrong password, try again.");
      return json({ success: true, authenticated: false });
    }
    if (await trySelectDriver(botToken, sb, chatId, userId, text)) {
      return json({ success: true, driver_selected: true });
    }
    if (cmdBase === "/menu") {
      const session = await requirePrivateAdmin(botToken, sb, chatId, userId, false);
      if (!session) return json({ success: true });
      const label = session.selected_driver_code
        ? `Menu for ${session.selected_driver_code}`
        : "Menu (send DRV-xxxx before status / updates / tour)";
      await reply(botToken, chatId, `${label} — pick an option:`, mainMenuKeyboard());
      return json({ success: true, menu: true });
    }
    if (cmdBase === "/status") {
      const session = await requirePrivateAdmin(botToken, sb, chatId, userId, true);
      if (!session?.selected_driver_id) return json({ success: true });
      await reply(botToken, chatId, await buildStatusText(sb, session.selected_driver_id), mainMenuKeyboard());
      return json({ success: true, status: true });
    }
    if (cmdBase === "/updates") {
      const session = await requirePrivateAdmin(botToken, sb, chatId, userId, true);
      if (!session?.selected_driver_id) return json({ success: true });
      await reply(botToken, chatId, await buildUpdatesText(sb, session.selected_driver_id), mainMenuKeyboard());
      return json({ success: true, updates: true });
    }
    if (cmdBase === "/tour" || cmdBase === "/loads") {
      const session = await requirePrivateAdmin(botToken, sb, chatId, userId, true);
      if (!session?.selected_driver_id) return json({ success: true });
      await reply(botToken, chatId, await buildTourText(sb, session.selected_driver_id), mainMenuKeyboard());
      return json({ success: true, tour: true });
    }
    if (cmdBase === "/link" || cmdBase === "/unlink" || cmdBase === "/whoami" || cmdBase === "/test") {
      await reply(
        botToken,
        chatId,
        "Use /link (button list), /unlink, /whoami, /test inside the driver Telegram group — not in this DM.",
      );
      return json({ success: true });
    }
    return json({ success: true, processed: false });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});
