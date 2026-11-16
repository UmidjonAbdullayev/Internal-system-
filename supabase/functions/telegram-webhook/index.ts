import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * Telegram Bot webhook — slash/menu ONLY in private DM with the bot.
 * Groups: no menus; /link /unlink only (typed). Facility-arrival pushes come from relay-telegram.
 * Security: TELEGRAM_ADMIN_PASSWORD (Edge secret) + DRV-xxxx driver selection.
 * TELEGRAM_BOT_TOKEN from Edge secrets only.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token",
};

const BOT_COMMANDS_PRIVATE = [
  { command: "menu", description: "Open status menu" },
  { command: "status", description: "Driver status + active loads" },
  { command: "updates", description: "Recent facility arrivals" },
  { command: "tour", description: "Tour / load info" },
  { command: "driver", description: "Select driver: /driver DRV-xxxx" },
  { command: "logout", description: "Clear admin session" },
  { command: "help", description: "List commands" },
];

const ACTIVE_LOAD_EXCLUDE = '("Completed","Cancelled","Rejected","Delivered")';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

let commandsEnsured = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function tg(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function reply(
  botToken: string,
  chatId: number | string,
  text: string,
  replyMarkup?: Record<string, unknown>,
) {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: text.slice(0, 3900),
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  await tg(botToken, "sendMessage", payload);
}

async function answerCallback(botToken: string, callbackQueryId: string, text?: string) {
  await tg(botToken, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text?.slice(0, 200),
    show_alert: false,
  });
}

async function ensureBotMenu(botToken: string) {
  if (commandsEnsured) return;
  // Clear default + group scopes so groups do not expose slash menus.
  await tg(botToken, "deleteMyCommands", { scope: { type: "default" } });
  await tg(botToken, "deleteMyCommands", { scope: { type: "all_group_chats" } });
  await tg(botToken, "deleteMyCommands", {
    scope: { type: "all_chat_administrators" },
  });
  // Menus only in private DM with the bot.
  await tg(botToken, "setMyCommands", {
    commands: BOT_COMMANDS_PRIVATE,
    scope: { type: "all_private_chats" },
  });

  const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  const info = await infoRes.json().catch(() => ({}));
  const url = info?.result?.url as string | undefined;
  const allowed = (info?.result?.allowed_updates as string[] | undefined) || [];
  if (url && !allowed.includes("callback_query")) {
    const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    const body: Record<string, unknown> = {
      url,
      allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member"],
    };
    if (secret) body.secret_token = secret;
    await tg(botToken, "setWebhook", body);
  }
  commandsEnsured = true;
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Driver status", callback_data: "menu:status" },
        { text: "Updates", callback_data: "menu:updates" },
      ],
      [
        { text: "Tour / loads", callback_data: "menu:tour" },
        { text: "Help", callback_data: "menu:help" },
      ],
    ],
  };
}

function updatesMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "All (48h)", callback_data: "upd:all" },
        { text: "Arrivals", callback_data: "upd:load" },
      ],
      [
        { text: "Trailer / link", callback_data: "upd:dispatch" },
      ],
      [{ text: "« Menu", callback_data: "menu:home" }],
    ],
  };
}

function tourMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Active loads", callback_data: "tour:active" },
        { text: "Today", callback_data: "tour:today" },
      ],
      [
        { text: "In transit", callback_data: "tour:transit" },
        { text: "Recent done", callback_data: "tour:done" },
      ],
      [{ text: "« Menu", callback_data: "menu:home" }],
    ],
  };
}

function isPrivateChat(chat: { type?: string } | undefined): boolean {
  return chat?.type === "private";
}

function isGroupChat(chat: { type?: string } | undefined): boolean {
  const t = chat?.type || "";
  return t === "group" || t === "supergroup";
}

type AdminSession = {
  telegram_user_id: number;
  selected_driver_id: string | null;
  selected_driver_code: string | null;
  expires_at: string;
};

async function getSession(
  sb: SupabaseClient,
  userId: number,
): Promise<AdminSession | null> {
  const { data } = await sb
    .from("telegram_admin_sessions")
    .select("telegram_user_id, selected_driver_id, selected_driver_code, expires_at")
    .eq("telegram_user_id", userId)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await sb.from("telegram_admin_sessions").delete().eq("telegram_user_id", userId);
    return null;
  }
  return data as AdminSession;
}

async function upsertAuthSession(sb: SupabaseClient, userId: number) {
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await sb.from("telegram_admin_sessions").upsert(
    {
      telegram_user_id: userId,
      authenticated_at: new Date().toISOString(),
      expires_at: expires,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "telegram_user_id" },
  );
}

async function selectDriverSession(
  sb: SupabaseClient,
  userId: number,
  driverUuid: string,
  driverCode: string,
) {
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await sb.from("telegram_admin_sessions").upsert(
    {
      telegram_user_id: userId,
      authenticated_at: new Date().toISOString(),
      expires_at: expires,
      selected_driver_id: driverUuid,
      selected_driver_code: driverCode,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "telegram_user_id" },
  );
}

function adminPasswordConfigured(): string | null {
  const p = Deno.env.get("TELEGRAM_ADMIN_PASSWORD");
  return p && p.length > 0 ? p : null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + "Z";
  } catch {
    return String(iso);
  }
}

async function buildStatusText(sb: SupabaseClient, driverUuid: string): Promise<string> {
  const { data: driver } = await sb
    .from("drivers")
    .select("driver_id, first_name, last_name, status, trailer_id, assigned_truck")
    .eq("id", driverUuid)
    .maybeSingle();
  const { data: loads } = await sb
    .from("loads")
    .select(
      "load_id, load_status, trailer_id, tractor_id, pickup_location, delivery_location, pickup_date, delivery_date, trip_bucket, parent_trip_id, status_bar_state, arrival_actual, arrival_scheduled, arrival_address",
    )
    .eq("driver_id", driverUuid)
    .not("load_status", "in", ACTIVE_LOAD_EXCLUDE)
    .order("delivery_date", { ascending: true })
    .limit(8);

  const lines = [
    `Driver: ${driver?.driver_id ?? "—"} ${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim(),
    `Status: ${driver?.status ?? "—"}`,
    `Truck: ${driver?.assigned_truck || "—"}`,
    `Trailer: ${driver?.trailer_id || "—"}`,
    `Active loads: ${(loads || []).length}`,
  ];
  for (const l of loads || []) {
    const trip = l.parent_trip_id || l.trip_bucket || "";
    const bar = l.status_bar_state ? ` bar=${l.status_bar_state}` : "";
    const arr = l.arrival_actual ? ` arr=${l.arrival_actual}` : "";
    const sch = l.arrival_scheduled ? ` sch=${l.arrival_scheduled}` : "";
    lines.push(
      `• ${l.load_id} [${l.load_status}] trailer=${l.trailer_id || "—"} tractor=${l.tractor_id || "—"} ${l.pickup_location || "—"} → ${l.delivery_location || "—"} (del ${l.delivery_date || "—"})${trip ? ` trip=${trip}` : ""}${bar}${arr}${sch}`,
    );
  }
  return lines.join("\n");
}

type UpdateFilter = "all" | "load" | "dispatch";

function updateEventFilter(filter: UpdateFilter): string[] | null {
  if (filter === "all") return null;
  if (filter === "load") {
    return ["facility_arrived", "loaded_enroute", "load_status_change", "status_digest"];
  }
  return ["trailer_change", "dispatch", "facility_arrived", "missing_page", "sync_error"];
}

async function buildUpdatesText(
  sb: SupabaseClient,
  chatId: string,
  driverUuid: string,
  filter: UpdateFilter,
): Promise<string> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  let q = sb
    .from("telegram_notification_history")
    .select("event_type, message, status, created_at")
    .eq("driver_id", driverUuid)
    .gte("created_at", since)
    .in("status", ["sent", "skipped", "failed"])
    .order("created_at", { ascending: false })
    .limit(12);

  const types = updateEventFilter(filter);
  if (types) q = q.in("event_type", types);

  const { data: rows } = await q;
  let chatRows: typeof rows = [];
  if (filter === "all" || filter === "dispatch") {
    const { data } = await sb
      .from("telegram_notification_history")
      .select("event_type, message, status, created_at")
      .eq("telegram_chat_id", chatId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(8);
    chatRows = data || [];
  }

  const merged = [...(rows || []), ...(chatRows || [])]
    .filter((r) => r.event_type !== "payment_change")
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .filter((r, i, arr) => {
      const key = `${r.created_at}|${r.event_type}|${r.message}`;
      return arr.findIndex((x) => `${x.created_at}|${x.event_type}|${x.message}` === key) === i;
    })
    .slice(0, 12);

  const labels: Record<UpdateFilter, string> = {
    all: "All updates (48h)",
    load: "Facility arrivals (48h)",
    dispatch: "Trailer / link (48h)",
  };

  if (!merged.length) {
    return `${labels[filter]}\nNo recent notifications for this driver.`;
  }

  const lines = [labels[filter], ""];
  for (const r of merged) {
    const msg = String(r.message || "").replace(/\s+/g, " ").slice(0, 160);
    lines.push(`• [${r.event_type}] ${fmtWhen(r.created_at)} — ${msg}`);
  }
  return lines.join("\n");
}

type TourView = "active" | "today" | "transit" | "done";

async function buildTourText(
  sb: SupabaseClient,
  driverUuid: string,
  view: TourView,
): Promise<string> {
  const { data: driver } = await sb
    .from("drivers")
    .select("driver_id, first_name, last_name, trailer_id")
    .eq("id", driverUuid)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const ascending = view !== "done";
  const limit = view === "done" ? 8 : 10;
  let query = sb
    .from("loads")
    .select(
      "load_id, load_status, trailer_id, tractor_id, pickup_location, delivery_location, pickup_date, delivery_date, trip_bucket, parent_trip_id, status_bar_state, arrival_actual, arrival_scheduled, arrival_address, last_observed",
    )
    .eq("driver_id", driverUuid);

  if (view === "active") {
    query = query.not("load_status", "in", ACTIVE_LOAD_EXCLUDE);
  } else if (view === "today") {
    query = query.or(`pickup_date.eq.${today},delivery_date.eq.${today}`);
  } else if (view === "transit") {
    query = query.or("load_status.ilike.%transit%,trip_bucket.eq.in_transit");
  } else {
    query = query.in("load_status", ["Completed", "Delivered", "Cancelled", "Rejected"]);
  }

  const { data: loads } = await query
    .order("delivery_date", { ascending })
    .limit(limit);
  const titles: Record<TourView, string> = {
    active: "Active loads",
    today: `Loads for today (${today})`,
    transit: "In transit",
    done: "Recently completed",
  };

  const lines = [
    `Tour — ${driver?.driver_id ?? "—"} ${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim(),
    titles[view],
    `Trailer: ${driver?.trailer_id || "—"}`,
    `Count: ${(loads || []).length}`,
    "",
  ];

  if (!(loads || []).length) {
    lines.push("No matching loads.");
    return lines.join("\n");
  }

  for (const l of loads || []) {
    const trip = l.parent_trip_id || l.trip_bucket || "—";
    const bar = l.status_bar_state ? ` | ${l.status_bar_state}` : "";
    const arr = l.arrival_actual ? `\n  Arrived: ${l.arrival_actual}` : "";
    const sch = l.arrival_scheduled ? `\n  Sch.: ${l.arrival_scheduled}` : "";
    const addr = l.arrival_address ? `\n  Addr: ${l.arrival_address}` : "";
    lines.push(
      `• ${l.load_id} [${l.load_status}] trailer=${l.trailer_id || "—"} tractor=${l.tractor_id || "—"}`,
      `  ${l.pickup_location || "—"} → ${l.delivery_location || "—"}`,
      `  pick ${l.pickup_date || "—"} · del ${l.delivery_date || "—"} · trip ${trip}${bar}${arr}${sch}${addr}`,
    );
  }
  return lines.join("\n");
}

function helpText(): string {
  return [
    "Amazon Relay Intelligence — private bot menu:",
    "1) Send the admin password (Edge secret TELEGRAM_ADMIN_PASSWORD)",
    "2) Send DRV-xxxx (or /driver DRV-xxxx) to select a driver",
    "3) Use /menu /status /updates /tour",
    "",
    "/logout — clear session",
    "/help — this message",
    "",
    "Driver groups: no slash menu. They only get facility-arrival alerts.",
    "Link a group by typing /link DRV-xxxx inside that group.",
  ].join("\n");
}

async function requirePrivateAdmin(
  botToken: string,
  sb: SupabaseClient,
  chatId: string,
  userId: number | null,
  needDriver: boolean,
): Promise<AdminSession | null> {
  const password = adminPasswordConfigured();
  if (!password) {
    await reply(
      botToken,
      chatId,
      "TELEGRAM_ADMIN_PASSWORD is not set on Edge secrets. Ask an admin to configure it in the Supabase Dashboard.",
    );
    return null;
  }
  if (!userId) {
    await reply(botToken, chatId, "Cannot identify Telegram user.");
    return null;
  }
  const session = await getSession(sb, userId);
  if (!session) {
    await reply(
      botToken,
      chatId,
      "Locked. Send the admin password first, then DRV-xxxx to select a driver.",
    );
    return null;
  }
  if (needDriver && !session.selected_driver_id) {
    await reply(
      botToken,
      chatId,
      "Authenticated. Send DRV-xxxx (or /driver DRV-xxxx) to select a driver, then open /menu.",
    );
    return null;
  }
  return session;
}

async function handleCallback(
  botToken: string,
  sb: SupabaseClient,
  cq: {
    id: string;
    data?: string;
    from?: { id?: number };
    message?: { chat?: { id?: number | string; type?: string }; message_id?: number };
  },
) {
  const chat = cq.message?.chat;
  const chatId = String(chat?.id ?? "");
  const data = String(cq.data || "");
  const userId = cq.from?.id ?? null;
  if (!chatId || !data) {
    await answerCallback(botToken, cq.id);
    return;
  }

  await answerCallback(botToken, cq.id);

  // Menus only in private chat
  if (!isPrivateChat(chat)) {
    await reply(botToken, chatId, "Menus are only available in a private chat with the bot.");
    return;
  }

  if (data === "menu:home") {
    const session = await requirePrivateAdmin(botToken, sb, chatId, userId, false);
    if (!session) return;
    await reply(botToken, chatId, "Choose an option:", mainMenuKeyboard());
    return;
  }
  if (data === "menu:help") {
    await reply(botToken, chatId, helpText(), mainMenuKeyboard());
    return;
  }
  if (data === "menu:updates") {
    const session = await requirePrivateAdmin(botToken, sb, chatId, userId, true);
    if (!session?.selected_driver_id) return;
    await reply(botToken, chatId, "Updates — pick a filter:", updatesMenuKeyboard());
    return;
  }
  if (data === "menu:tour") {
    const session = await requirePrivateAdmin(botToken, sb, chatId, userId, true);
    if (!session?.selected_driver_id) return;
    await reply(botToken, chatId, "Tour / loads — pick a view:", tourMenuKeyboard());
    return;
  }

  const session = await requirePrivateAdmin(botToken, sb, chatId, userId, true);
  if (!session?.selected_driver_id) return;

  if (data === "menu:status") {
    const text = await buildStatusText(sb, session.selected_driver_id);
    await reply(botToken, chatId, text, mainMenuKeyboard());
    return;
  }

  if (data.startsWith("upd:")) {
    const filter = data.slice(4) as UpdateFilter;
    if (!["all", "load", "dispatch"].includes(filter)) return;
    const text = await buildUpdatesText(sb, chatId, session.selected_driver_id, filter);
    await reply(botToken, chatId, text, updatesMenuKeyboard());
    return;
  }

  if (data.startsWith("tour:")) {
    const view = data.slice(5) as TourView;
    if (!["active", "today", "transit", "done"].includes(view)) return;
    const text = await buildTourText(sb, session.selected_driver_id, view);
    await reply(botToken, chatId, text, tourMenuKeyboard());
    return;
  }
}

async function tryAuthPassword(
  botToken: string,
  sb: SupabaseClient,
  chatId: string,
  userId: number,
  text: string,
): Promise<boolean> {
  const password = adminPasswordConfigured();
  if (!password) return false;
  const candidate = text.replace(/^\/auth(?:@\w+)?\s+/i, "").trim();
  if (!candidate || !timingSafeEqual(candidate, password)) return false;
  await upsertAuthSession(sb, userId);
  await reply(
    botToken,
    chatId,
    "Admin unlocked (12h). Send DRV-xxxx (or /driver DRV-xxxx) to select a driver, then /menu.",
  );
  return true;
}

async function trySelectDriver(
  botToken: string,
  sb: SupabaseClient,
  chatId: string,
  userId: number,
  text: string,
): Promise<boolean> {
  const m =
    text.match(/^\/driver(?:@\w+)?\s+(DRV-\S+)/i) ||
    text.match(/^(DRV-\S+)$/i);
  if (!m) return false;
  const session = await getSession(sb, userId);
  if (!session) {
    await reply(botToken, chatId, "Send the admin password first.");
    return true;
  }
  const driverCode = m[1].trim().toUpperCase();
  const { data: driver } = await sb
    .from("drivers")
    .select("id, driver_id, first_name, last_name")
    .eq("driver_id", driverCode)
    .maybeSingle();
  if (!driver) {
    await reply(botToken, chatId, `No CRM driver found for \`${driverCode}\`.`);
    return true;
  }
  await selectDriverSession(sb, userId, driver.id, driver.driver_id);
  await reply(
    botToken,
    chatId,
    `Selected ${driver.driver_id} (${driver.first_name} ${driver.last_name}). Open /menu.`,
    mainMenuKeyboard(),
  );
  return true;
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

    // ——— Groups: no menus; only /link /unlink ———
    if (isGroupChat(chat)) {
      const link = text.match(/^\/link(?:@\w+)?\s+(\S+)/i);
      if (link) {
        const driverCode = link[1].trim();
        const { data: driver } = await sb
          .from("drivers")
          .select("id, driver_id, first_name, last_name")
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
          `Linked to ${driver.driver_id} (${driver.first_name} ${driver.last_name}).\nThis group only receives facility-arrival alerts (no slash menu). Use the bot DM for status menus.`,
        );
        return json({ success: true, linked: true, driver_id: driver.id });
      }

      if (cmdBase === "/unlink") {
        await sb
          .from("driver_telegram_groups")
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq("telegram_chat_id", chatId);
        await reply(botToken, chatId, "Group unlinked (set inactive). Type /link DRV-xxxx to re-link.");
        return json({ success: true, unlinked: true });
      }

      if (
        cmdBase === "/menu" ||
        cmdBase === "/start" ||
        cmdBase === "/status" ||
        cmdBase === "/updates" ||
        cmdBase === "/tour" ||
        cmdBase === "/loads" ||
        cmdBase === "/help"
      ) {
        await reply(
          botToken,
          chatId,
          "Menus are disabled in groups. Open a private chat with @inter_sysbot, unlock with the admin password, then send DRV-xxxx.",
        );
        return json({ success: true, redirected: "dm_only" });
      }

      // Keep title fresh if linked
      await sb
        .from("driver_telegram_groups")
        .update({
          group_title: chatTitle,
          updated_at: new Date().toISOString(),
          bot_can_post: true,
          last_error: null,
        })
        .eq("telegram_chat_id", chatId);

      return json({ success: true, processed: false, group: true });
    }

    // ——— Private DM: password + DRV gate ———
    if (!isPrivateChat(chat) || userId == null) {
      return json({ success: true, ignored: true });
    }

    if (cmdBase === "/logout") {
      await sb.from("telegram_admin_sessions").delete().eq("telegram_user_id", userId);
      await reply(botToken, chatId, "Session cleared. Send the admin password to unlock again.");
      return json({ success: true, logout: true });
    }

    if (cmdBase === "/help") {
      await reply(botToken, chatId, helpText());
      return json({ success: true });
    }

    if (cmdBase === "/start") {
      await reply(botToken, chatId, helpText());
      return json({ success: true, start: true });
    }

    // Plain password or /auth <password>
    if (await tryAuthPassword(botToken, sb, chatId, userId, text)) {
      return json({ success: true, authenticated: true });
    }

    // DRV-xxxx or /driver DRV-xxxx
    if (await trySelectDriver(botToken, sb, chatId, userId, text)) {
      return json({ success: true, driver_selected: true });
    }

    if (cmdBase === "/menu") {
      const session = await requirePrivateAdmin(botToken, sb, chatId, userId, true);
      if (!session?.selected_driver_id) return json({ success: true });
      await reply(
        botToken,
        chatId,
        `Menu for ${session.selected_driver_code || "driver"} — pick an option:`,
        mainMenuKeyboard(),
      );
      return json({ success: true, menu: true });
    }

    if (cmdBase === "/status") {
      const session = await requirePrivateAdmin(botToken, sb, chatId, userId, true);
      if (!session?.selected_driver_id) return json({ success: true });
      const statusText = await buildStatusText(sb, session.selected_driver_id);
      await reply(botToken, chatId, statusText, mainMenuKeyboard());
      return json({ success: true, status: true });
    }

    if (cmdBase === "/updates") {
      const session = await requirePrivateAdmin(botToken, sb, chatId, userId, true);
      if (!session?.selected_driver_id) return json({ success: true });
      const snap = await buildUpdatesText(sb, chatId, session.selected_driver_id, "all");
      await reply(botToken, chatId, snap + "\n\nFilter:", updatesMenuKeyboard());
      return json({ success: true, updates: true });
    }

    if (cmdBase === "/tour" || cmdBase === "/loads") {
      const session = await requirePrivateAdmin(botToken, sb, chatId, userId, true);
      if (!session?.selected_driver_id) return json({ success: true });
      const snap = await buildTourText(sb, session.selected_driver_id, "active");
      await reply(botToken, chatId, snap + "\n\nMore views:", tourMenuKeyboard());
      return json({ success: true, tour: true });
    }

    // Reject /link in DM — linking is group-scoped
    if (cmdBase === "/link" || cmdBase === "/unlink") {
      await reply(
        botToken,
        chatId,
        "Use /link DRV-xxxx inside the driver Telegram group (not in this DM).",
      );
      return json({ success: true });
    }

    return json({ success: true, processed: false });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});
