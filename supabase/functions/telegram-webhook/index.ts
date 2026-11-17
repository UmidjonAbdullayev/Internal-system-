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
  setLateReason,
  muteTrip,
  setDispatchChat,
  crmBaseUrl,
  openCrmMarkup,
  listRelayDriversForLink,
  linkDriverKeyboard,
  linkDriverGroup,
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
      // /link — admins: show Relay driver buttons (or link by Relay id / DRV code)
      if (cmdBase === "/link") {
        const arg = text.replace(/^\/link(?:@\w+)?\s*/i, "").trim();
        if (arg) {
          // Prefer Relay id; fall back to CRM DRV-xxxx → match name into recent Relay drivers
          let relayId = arg;
          let driverName: string | null = null;
          if (/^DRV-/i.test(arg)) {
            const { data: crm } = await sb
              .from("drivers")
              .select("first_name, last_name, driver_id")
              .eq("driver_id", arg.toUpperCase())
              .maybeSingle();
            if (!crm) {
              await reply(botToken, chatId, `No CRM driver for ${arg}. Use /link and pick from the list.`);
              return json({ success: true, linked: false });
            }
            const drivers = await listRelayDriversForLink(sb, 80);
            const needle = `${crm.first_name} ${crm.last_name}`.trim().toLowerCase();
            const hit = drivers.find((d) => d.name.toLowerCase() === needle) ||
              drivers.find((d) => d.name.toLowerCase().includes(String(crm.last_name || "").toLowerCase()));
            if (!hit) {
              await reply(
                botToken,
                chatId,
                `CRM ${crm.driver_id} found but no matching Relay driver id yet. Pick from the list:`,
                linkDriverKeyboard(drivers),
              );
              return json({ success: true, linked: false, need_pick: true });
            }
            relayId = hit.id;
            driverName = hit.name;
          }
          const { error } = await linkDriverGroup(
            sb,
            chatId,
            relayId,
            chatTitle,
            userId != null ? String(userId) : null,
            driverName,
          );
          if (error) {
            await reply(botToken, chatId, `Link failed: ${error.message}`);
            return json({ success: false, error: error.message }, 500);
          }
          await reply(
            botToken,
            chatId,
            `Linked to Relay driver ${driverName || relayId}.\n/whoami · /test · /unlink`,
          );
          return json({ success: true, linked: true, relay_driver_id: relayId });
        }
        const drivers = await listRelayDriversForLink(sb, 24);
        await reply(
          botToken,
          chatId,
          "Pick a Relay driver to link this group (admins). Trip alerts for that driver go here.",
          linkDriverKeyboard(drivers),
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
        const { data: g } = await sb
          .from("driver_groups")
          .select("relay_driver_id, driver_name, active, group_title")
          .eq("chat_id", chatId)
          .maybeSingle();
        if (!g || !g.active) {
          await reply(botToken, chatId, "Not linked. Use /link to choose a Relay driver.");
          return json({ success: true, whoami: false });
        }
        await reply(
          botToken,
          chatId,
          `This group → ${g.driver_name || "Relay driver"}\n<code>${g.relay_driver_id}</code>`,
          undefined,
          "HTML",
        );
        return json({ success: true, whoami: true, relay_driver_id: g.relay_driver_id });
      }
      if (cmdBase === "/test") {
        const { data: g } = await sb
          .from("driver_groups")
          .select("relay_driver_id, active")
          .eq("chat_id", chatId)
          .maybeSingle();
        if (!g?.active) {
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
            ? "[TEST] samples queued to this group only. Kill switch stays OFF until you enable TELEGRAM_ALERTS_ENABLED."
            : `Test failed: ${JSON.stringify(body).slice(0, 400)}`,
        );
        return json({ success: res.ok, test: true, body });
      }
      // Dispatch trip alert commands (typed; no group slash menu)
      if (cmdBase === "/setdispatch") {
        await setDispatchChat(sb, chatId);
        await reply(
          botToken,
          chatId,
          "This group is now the default dispatch alert chat (telegram_alert_config.default_chat_id).",
        );
        return json({ success: true, setdispatch: true, chat_id: chatId });
      }
      if (cmdBase === "/late") {
        const m = text.match(/^\/late(?:@\w+)?\s+(\S+)\s+(.+)$/i);
        if (!m) {
          await reply(botToken, chatId, "Usage: /late <tripId> <reason>");
          return json({ success: true, late: false });
        }
        const result = await setLateReason(sb, m[1], m[2]);
        if (!result.ok) {
          await reply(botToken, chatId, result.error || "Failed");
          return json({ success: false, late: false });
        }
        const base = await crmBaseUrl(sb);
        await reply(
          botToken,
          chatId,
          `Late reason saved for ${result.tripId}.`,
          openCrmMarkup(base, result.tripId),
        );
        return json({ success: true, late: true, trip_id: result.tripId });
      }
      if (cmdBase === "/status") {
        const m = text.match(/^\/status(?:@\w+)?\s+(\S+)/i);
        if (!m) {
          await reply(
            botToken,
            chatId,
            "In groups use /status <tripId>. Full driver menus are DM-only with @inter_sysbot.",
          );
          return json({ success: true, redirected: "need_trip" });
        }
        const body = await buildTripStatusById(sb, m[1]);
        const base = await crmBaseUrl(sb);
        await reply(botToken, chatId, body, openCrmMarkup(base, m[1].trim().toUpperCase()));
        return json({ success: true, status: true, trip: true });
      }
      if (cmdBase === "/mute") {
        const m = text.match(/^\/mute(?:@\w+)?\s+(\S+)(?:\s+(\d+))?/i);
        if (!m) {
          await reply(botToken, chatId, "Usage: /mute <tripId> [hours]");
          return json({ success: true, mute: false });
        }
        const hours = m[2] ? Number(m[2]) : 24;
        const msg = await muteTrip(
          sb,
          m[1],
          chatId,
          hours,
          userId != null ? String(userId) : null,
        );
        await reply(botToken, chatId, msg);
        return json({ success: true, mute: true });
      }
      if (["/menu", "/start", "/updates", "/tour", "/loads", "/help"].includes(cmdBase)) {
        await reply(
          botToken,
          chatId,
          "Menus are disabled in groups. Open a private chat with @inter_sysbot, unlock with the admin password, then send DRV-xxxx.\nGroup alert cmds: /late /status <tripId> /mute <tripId> /setdispatch",
        );
        return json({ success: true, redirected: "dm_only" });
      }
      return json({ success: true, processed: false, group: true });
    }

    if (!isPrivateChat(chat) || userId == null) return json({ success: true, ignored: true });

    if (cmdBase === "/logout") {
      await sb.from("telegram_admin_sessions").delete().eq("telegram_user_id", userId);
      await reply(botToken, chatId, "Session cleared. Send the admin password to unlock again.");
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
    if (authAttempt === "ok") return json({ success: true, authenticated: true });
    if (authAttempt === "unset") {
      await reply(
        botToken,
        chatId,
        "TELEGRAM_ADMIN_PASSWORD is not set on Edge secrets. Ask an admin to configure it in the Supabase Dashboard.",
      );
      return json({ success: true, authenticated: false, reason: "password_unset" });
    }
    if (authAttempt === "wrong") {
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
