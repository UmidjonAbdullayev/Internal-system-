import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * Telegram Bot webhook for per-driver groups.
 * Slash menu (setMyCommands) + on-demand status:
 *   /menu /status /updates /tour /help /link /unlink
 * Inline keyboards for Updates vs Tour/load subchoices.
 * Auth: Telegram secret token header OR ?secret= matching TELEGRAM_WEBHOOK_SECRET
 * TELEGRAM_BOT_TOKEN from Edge secrets only.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token",
};

const BOT_COMMANDS = [
  { command: "menu", description: "Open status menu" },
  { command: "status", description: "Driver status + active loads" },
  { command: "updates", description: "Recent alerts & changes" },
  { command: "tour", description: "Tour / load info" },
  { command: "help", description: "List commands" },
  { command: "link", description: "Link group: /link DRV-xxxx" },
  { command: "unlink", description: "Unlink this group" },
];

const ACTIVE_LOAD_EXCLUDE = '("Completed","Cancelled","Rejected","Delivered")';

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
  await tg(botToken, "setMyCommands", { commands: BOT_COMMANDS });
  // Ensure callback buttons work (webhook may have been registered without callback_query)
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
        { text: "Load status", callback_data: "upd:load" },
      ],
      [
        { text: "Payments", callback_data: "upd:pay" },
        { text: "Trailer / dispatch", callback_data: "upd:dispatch" },
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

type LinkedGroup = { driver_id: string; active: boolean };

async function getLinkedGroup(
  sb: SupabaseClient,
  chatId: string,
): Promise<LinkedGroup | null> {
  const { data: group } = await sb
    .from("driver_telegram_groups")
    .select("driver_id, active")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (!group?.driver_id || !group.active) return null;
  return group as LinkedGroup;
}

async function requireLinked(
  botToken: string,
  sb: SupabaseClient,
  chatId: string,
): Promise<LinkedGroup | null> {
  const group = await getLinkedGroup(sb, chatId);
  if (!group) {
    await reply(botToken, chatId, "This group is not linked. Use /link DRV-xxxx");
    return null;
  }
  return group;
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
      "load_id, load_status, trailer_id, pickup_location, delivery_location, pickup_date, delivery_date, trip_bucket, parent_trip_id, status_bar_state",
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
    lines.push(
      `• ${l.load_id} [${l.load_status}] trailer=${l.trailer_id || "—"} ${l.pickup_location || "—"} → ${l.delivery_location || "—"} (del ${l.delivery_date || "—"})${trip ? ` trip=${trip}` : ""}${bar}`,
    );
  }
  return lines.join("\n");
}

type UpdateFilter = "all" | "load" | "pay" | "dispatch";

function updateEventFilter(filter: UpdateFilter): string[] | null {
  if (filter === "all") return null;
  if (filter === "load") {
    return [
      "load_status_change",
      "loaded_enroute",
      "facility_arrived",
      "status_digest",
      "driver_status",
    ];
  }
  if (filter === "pay") {
    return ["payment_status_change", "payment_received", "pay_status"];
  }
  return [
    "trailer_change",
    "dispatch",
    "missing_page",
    "sync_error",
    "loaded_enroute",
    "facility_arrived",
  ];
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
  // Also include chat-scoped rows (ops-style) when filter is all/dispatch
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
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .filter((r, i, arr) => {
      const key = `${r.created_at}|${r.event_type}|${r.message}`;
      return arr.findIndex((x) => `${x.created_at}|${x.event_type}|${x.message}` === key) === i;
    })
    .slice(0, 12);

  const labels: Record<UpdateFilter, string> = {
    all: "All updates (48h)",
    load: "Load status updates (48h)",
    pay: "Payment updates (48h)",
    dispatch: "Trailer / dispatch (48h)",
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
      "load_id, load_status, payment_status, trailer_id, pickup_location, delivery_location, pickup_date, delivery_date, trip_bucket, parent_trip_id, rate_gross, status_bar_state, last_observed",
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
    const rate = l.rate_gross != null ? ` $${l.rate_gross}` : "";
    const bar = l.status_bar_state ? ` | ${l.status_bar_state}` : "";
    lines.push(
      `• ${l.load_id} [${l.load_status}] pay=${l.payment_status || "—"}`,
      `  ${l.pickup_location || "—"} → ${l.delivery_location || "—"}`,
      `  pick ${l.pickup_date || "—"} · del ${l.delivery_date || "—"} · trip ${trip}${rate}${bar}`,
    );
  }
  return lines.join("\n");
}

function helpText(): string {
  return [
    "Amazon Relay Intelligence — slash commands:",
    "/menu — open status menu (buttons)",
    "/status — driver + active loads (incl. trailer)",
    "/updates — recent alerts; opens filter menu",
    "/tour — tour/load info; opens load menu",
    "/link DRV-xxxx — associate this group with a CRM driver",
    "/unlink — deactivate this group link",
    "/help — this message",
    "",
    "Tip: type / in Telegram to see the command menu.",
  ].join("\n");
}

async function handleCallback(
  botToken: string,
  sb: SupabaseClient,
  cq: {
    id: string;
    data?: string;
    message?: { chat?: { id?: number | string }; message_id?: number };
  },
) {
  const chatId = String(cq.message?.chat?.id ?? "");
  const data = String(cq.data || "");
  if (!chatId || !data) {
    await answerCallback(botToken, cq.id);
    return;
  }

  await answerCallback(botToken, cq.id);

  if (data === "menu:home") {
    await reply(botToken, chatId, "Choose an option:", mainMenuKeyboard());
    return;
  }
  if (data === "menu:help") {
    await reply(botToken, chatId, helpText(), mainMenuKeyboard());
    return;
  }
  if (data === "menu:updates") {
    await reply(botToken, chatId, "Updates — pick a filter:", updatesMenuKeyboard());
    return;
  }
  if (data === "menu:tour") {
    await reply(botToken, chatId, "Tour / loads — pick a view:", tourMenuKeyboard());
    return;
  }

  const group = await requireLinked(botToken, sb, chatId);
  if (!group) return;

  if (data === "menu:status") {
    const text = await buildStatusText(sb, group.driver_id);
    await reply(botToken, chatId, text, mainMenuKeyboard());
    return;
  }

  if (data.startsWith("upd:")) {
    const filter = data.slice(4) as UpdateFilter;
    if (!["all", "load", "pay", "dispatch"].includes(filter)) return;
    const text = await buildUpdatesText(sb, chatId, group.driver_id, filter);
    await reply(botToken, chatId, text, updatesMenuKeyboard());
    return;
  }

  if (data.startsWith("tour:")) {
    const view = data.slice(5) as TourView;
    if (!["active", "today", "transit", "done"].includes(view)) return;
    const text = await buildTourText(sb, group.driver_id, view);
    await reply(botToken, chatId, text, tourMenuKeyboard());
    return;
  }
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

    // Inline button presses
    if (update.callback_query) {
      await handleCallback(botToken, sb, update.callback_query);
      return json({ success: true, callback: true });
    }

    const msg = update.message || update.edited_message || update.channel_post;
    if (!msg?.chat?.id) return json({ success: true, ignored: true });

    const chatId = String(msg.chat.id);
    const chatTitle = msg.chat.title || msg.chat.username || null;
    const text = String(msg.text || msg.caption || "").trim();
    if (!text) return json({ success: true, ignored: true });

    // Strip bot mention for command matching: /status@inter_sysbot
    const cmd = text.split(/\s+/)[0] || "";
    const cmdBase = cmd.replace(/@\w+$/i, "").toLowerCase();

    // /link DRV-1024
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
        `Linked this group to driver ${driver.driver_id} (${driver.first_name} ${driver.last_name}).\nAlerts for this driver will post here only.\n\nUse /menu for on-demand status.`,
        mainMenuKeyboard(),
      );
      return json({ success: true, linked: true, driver_id: driver.id });
    }

    if (cmdBase === "/unlink") {
      await sb
        .from("driver_telegram_groups")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("telegram_chat_id", chatId);
      await reply(botToken, chatId, "Group unlinked (set inactive). Use /link DRV-xxxx to re-link.");
      return json({ success: true, unlinked: true });
    }

    if (cmdBase === "/start" || cmdBase === "/menu") {
      await reply(
        botToken,
        chatId,
        "Amazon Relay Intelligence — pick a status option (or type / for commands):",
        mainMenuKeyboard(),
      );
      return json({ success: true, menu: true });
    }

    if (cmdBase === "/help") {
      await reply(botToken, chatId, helpText(), mainMenuKeyboard());
      return json({ success: true });
    }

    if (cmdBase === "/status") {
      const group = await requireLinked(botToken, sb, chatId);
      if (!group) return json({ success: true });
      const statusText = await buildStatusText(sb, group.driver_id);
      await reply(botToken, chatId, statusText, mainMenuKeyboard());
      return json({ success: true, status: true });
    }

    if (cmdBase === "/updates") {
      const group = await requireLinked(botToken, sb, chatId);
      if (!group) return json({ success: true });
      // Show filter menu + a default "all" snapshot
      const snap = await buildUpdatesText(sb, chatId, group.driver_id, "all");
      await reply(botToken, chatId, snap + "\n\nFilter:", updatesMenuKeyboard());
      return json({ success: true, updates: true });
    }

    if (cmdBase === "/tour" || cmdBase === "/loads") {
      const group = await requireLinked(botToken, sb, chatId);
      if (!group) return json({ success: true });
      const snap = await buildTourText(sb, group.driver_id, "active");
      await reply(botToken, chatId, snap + "\n\nMore views:", tourMenuKeyboard());
      return json({ success: true, tour: true });
    }

    // Refresh title if linked
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
