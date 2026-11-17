import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token",
};
export const BOT_COMMANDS_PRIVATE = [
  { command: "menu", description: "Admin menu (sync / late / stats / groups)" },
  { command: "status", description: "Driver status + active loads" },
  { command: "updates", description: "Recent facility arrivals" },
  { command: "tour", description: "Tour / load info" },
  { command: "driver", description: "Select driver: /driver DRV-xxxx" },
  { command: "logout", description: "Clear admin session" },
  { command: "help", description: "List commands" },
  { command: "late", description: "/late <tripId> <reason>" },
  { command: "mute", description: "/mute <tripId> [hours]" },
  { command: "link", description: "Link this group to a Relay driver (admins)" },
  { command: "unlink", description: "Unlink this group" },
  { command: "whoami", description: "Show linked driver for this group" },
  { command: "test", description: "Send [TEST] alerts to this linked group" },
];
export const ACTIVE_LOAD_EXCLUDE = '("Completed","Cancelled","Rejected","Delivered")';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export let commandsEnsured = false;

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
export async function tg(botToken: string, method: string, body: Record<string, unknown>) {
  return await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
export async function reply(
  botToken: string,
  chatId: number | string,
  text: string,
  replyMarkup?: Record<string, unknown>,
  parseMode?: string,
) {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: text.slice(0, 3900),
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  if (parseMode) payload.parse_mode = parseMode;
  await tg(botToken, "sendMessage", payload);
}

export async function crmBaseUrl(sb: SupabaseClient): Promise<string> {
  const { data } = await sb
    .from("telegram_alert_config")
    .select("crm_base_url")
    .eq("id", 1)
    .maybeSingle();
  return String(data?.crm_base_url || "https://internal-system-lac.vercel.app").replace(/\/$/, "");
}

export function openCrmMarkup(base: string, tripId: string) {
  return {
    inline_keyboard: [[{ text: "Open in CRM", url: `${base}/loads?q=${encodeURIComponent(tripId)}` }]],
  };
}

export async function buildTripStatusById(sb: SupabaseClient, tripIdRaw: string): Promise<string> {
  const tripId = tripIdRaw.trim().toUpperCase();
  const { data: trip } = await sb
    .from("relay_trips")
    .select("trip_id, section, status, driver_name_raw, start_time, execution_status")
    .eq("trip_id", tripId)
    .maybeSingle();
  if (trip) {
    const { data: stops } = await sb
      .from("relay_stops")
      .select("seq, facility_code, stop_type, scheduled_arrival, actual_arrival, eta")
      .eq("trip_id", tripId)
      .eq("archived", false)
      .order("seq", { ascending: true })
      .limit(6);
    const lines = [
      `Trip ${trip.trip_id}`,
      `Section: ${trip.section || "—"} · ${trip.status || trip.execution_status || "—"}`,
      `Driver: ${trip.driver_name_raw || "—"}`,
      `Start: ${trip.start_time || "—"}`,
      `Stops: ${(stops || []).length}`,
    ];
    for (const s of stops || []) {
      lines.push(
        `• ${s.seq ?? "?"} ${s.facility_code || s.stop_type || "Stop"} sch=${s.scheduled_arrival || "—"} act=${s.actual_arrival || "—"}`,
      );
    }
    return lines.join("\n");
  }
  const { data: load } = await sb
    .from("loads")
    .select(
      "load_id, parent_trip_id, load_status, trip_bucket, driver_name_raw, pickup_location, delivery_location, arrival_actual, arrival_scheduled, late_reason",
    )
    .or(`load_id.eq.${tripId},parent_trip_id.eq.${tripId}`)
    .limit(5);
  if (!load?.length) return `No trip/load found for ${tripId}`;
  const lines = [`Trip/load ${tripId}`, `Matches: ${load.length}`];
  for (const l of load) {
    lines.push(
      `• ${l.load_id} [${l.load_status}/${l.trip_bucket}] ${l.driver_name_raw || "—"}`,
      `  ${l.pickup_location || "—"} → ${l.delivery_location || "—"}`,
      `  Arr ${l.arrival_actual || "—"} Sch ${l.arrival_scheduled || "—"} Late: ${l.late_reason || "—"}`,
    );
  }
  return lines.join("\n");
}

export async function setLateReason(
  sb: SupabaseClient,
  tripIdRaw: string,
  reason: string,
): Promise<{ ok: boolean; tripId: string; error?: string }> {
  const tripId = tripIdRaw.trim().toUpperCase();
  const reasonTrim = reason.trim().slice(0, 500);
  if (!reasonTrim) return { ok: false, tripId, error: "reason required" };
  const now = new Date().toISOString();
  const { data: loads } = await sb
    .from("loads")
    .select("id, load_id, parent_trip_id")
    .or(`load_id.eq.${tripId},parent_trip_id.eq.${tripId}`);
  if (loads?.length) {
    await sb
      .from("loads")
      .update({ late_reason: reasonTrim, late_reason_at: now, updated_at: now })
      .or(`load_id.eq.${tripId},parent_trip_id.eq.${tripId}`);
  }
  await sb
    .from("relay_stops")
    .update({ late_reason: reasonTrim, late_reason_at: now, updated_at: now })
    .eq("trip_id", tripId)
    .is("late_reason", null);
  // Fire late_reason alert via trip-alerts
  const base = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (base && service) {
    try {
      await fetch(`${base}/functions/v1/trip-alerts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${service}`,
        },
        body: JSON.stringify({
          action: "status",
          events: [{
            kind: "late_reason",
            tripId,
            section: "IN_TRANSIT",
            lateReason: reasonTrim,
          }],
        }),
      });
    } catch {
      /* non-fatal */
    }
  }
  return { ok: true, tripId };
}

export async function muteTrip(
  sb: SupabaseClient,
  tripIdRaw: string,
  chatId: string,
  hours: number,
  mutedBy: string | null,
): Promise<string> {
  const tripId = tripIdRaw.trim().toUpperCase();
  const hrs = Number.isFinite(hours) && hours > 0 ? hours : 24;
  const until = new Date(Date.now() + hrs * 3600_000).toISOString();
  await sb.from("telegram_trip_mutes").upsert(
    {
      trip_id: tripId,
      chat_id: chatId,
      muted_until: until,
      muted_by: mutedBy,
    },
    { onConflict: "trip_id,chat_id" },
  );
  return `Muted ${tripId} for ${hrs}h (until ${until})`;
}

export async function setDispatchChat(sb: SupabaseClient, chatId: string): Promise<void> {
  await sb
    .from("telegram_alert_config")
    .update({ default_chat_id: chatId, updated_at: new Date().toISOString() })
    .eq("id", 1);
}
export async function answerCallback(botToken: string, callbackQueryId: string, text?: string) {
  await tg(botToken, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text?.slice(0, 200),
    show_alert: false,
  });
}
export async function ensureBotMenu(botToken: string) {
  if (commandsEnsured) return;
  await tg(botToken, "deleteMyCommands", { scope: { type: "default" } });
  await tg(botToken, "deleteMyCommands", { scope: { type: "all_group_chats" } });
  await tg(botToken, "deleteMyCommands", { scope: { type: "all_chat_administrators" } });
  await tg(botToken, "setMyCommands", {
    commands: BOT_COMMANDS_PRIVATE,
    scope: { type: "all_private_chats" },
  });
  const projectUrl = Deno.env.get("SUPABASE_URL") || "https://iiyqkdjwxlnfqvlidbqr.supabase.co";
  const webhookUrl = `${projectUrl}/functions/v1/telegram-webhook`;
  const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  const info = await infoRes.json().catch(() => ({}));
  const url = info?.result?.url as string | undefined;
  const allowed = (info?.result?.allowed_updates as string[] | undefined) || [];
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  const needSet = !url || url !== webhookUrl || !allowed.includes("callback_query");
  if (needSet) {
    const body: Record<string, unknown> = {
      url: webhookUrl,
      allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member"],
    };
    if (secret) body.secret_token = secret;
    await tg(botToken, "setWebhook", body);
  }
  commandsEnsured = true;
}
export function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Sync status", callback_data: "menu:sync" },
        { text: "Late trips now", callback_data: "menu:late" },
      ],
      [
        { text: "Today's stats", callback_data: "menu:today" },
        { text: "Find trip", callback_data: "menu:find" },
      ],
      [
        { text: "Driver groups", callback_data: "menu:groups" },
        { text: "Help", callback_data: "menu:help" },
      ],
    ],
  };
}

/** Distinct Relay drivers from recent trip raw payloads for /link buttons. */
export async function listRelayDriversForLink(sb: SupabaseClient, limit = 24) {
  const { data } = await sb
    .from("relay_trips")
    .select("raw, driver_name_raw, last_seen_at")
    .eq("archived", false)
    .order("last_seen_at", { ascending: false })
    .limit(80);
  const map = new Map<string, string>();
  for (const row of data || []) {
    const raw = row.raw as Record<string, unknown> | null;
    const drivers = Array.isArray(raw?.drivers) ? raw!.drivers : [];
    for (const d of drivers) {
      if (!d || typeof d !== "object") continue;
      const id = String((d as Record<string, unknown>).id || "").trim();
      if (!id || map.has(id)) continue;
      const first = String((d as Record<string, unknown>).firstName || "").trim();
      const last = String((d as Record<string, unknown>).lastName || "").trim();
      const name = [first, last].filter(Boolean).join(" ") || row.driver_name_raw || id.slice(-8);
      map.set(id, name);
      if (map.size >= limit) break;
    }
    if (map.size >= limit) break;
  }
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

export function linkDriverKeyboard(drivers: Array<{ id: string; name: string }>) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const d of drivers) {
    const label = d.name.slice(0, 40);
    rows.push([{ text: label, callback_data: `linkdrv:${d.id}` }]);
  }
  if (!rows.length) {
    rows.push([{ text: "No Relay drivers found yet", callback_data: "linkdrv:none" }]);
  }
  return { inline_keyboard: rows };
}

export async function linkDriverGroup(
  sb: SupabaseClient,
  chatId: string,
  relayDriverId: string,
  groupTitle: string | null,
  linkedBy: string | null,
  driverName?: string | null,
) {
  return await sb.from("driver_groups").upsert(
    {
      chat_id: chatId,
      relay_driver_id: relayDriverId,
      driver_name: driverName || null,
      group_title: groupTitle,
      active: true,
      linked_by: linkedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chat_id" },
  );
}
export function isPrivateChat(chat: { type?: string } | undefined) {
  return chat?.type === "private";
}
export function isGroupChat(chat: { type?: string } | undefined) {
  const t = chat?.type || "";
  return t === "group" || t === "supergroup";
}
export type AdminSession = {
  telegram_user_id: number;
  selected_driver_id: string | null;
  selected_driver_code: string | null;
  expires_at: string;
};
export function askPasswordOnceText() {
  return [
    "Welcome to Amazon Relay Intelligence.",
    "",
    "Send the admin password once to unlock this chat.",
    "After that you stay unlocked — no password on every command.",
    "When you look up a driver, send DRV-xxxx (or /driver DRV-xxxx).",
  ].join("\n");
}
export function adminPasswordConfigured() {
  const p = Deno.env.get("TELEGRAM_ADMIN_PASSWORD");
  return p && p.length > 0 ? p : null;
}
export function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
export async function getSession(sb: SupabaseClient, userId: number): Promise<AdminSession | null> {
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
export async function touchSession(sb: SupabaseClient, userId: number) {
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await sb
    .from("telegram_admin_sessions")
    .update({ expires_at: expires, updated_at: new Date().toISOString() })
    .eq("telegram_user_id", userId);
}
export async function upsertAuthSession(sb: SupabaseClient, userId: number) {
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const existing = await getSession(sb, userId);
  await sb.from("telegram_admin_sessions").upsert(
    {
      telegram_user_id: userId,
      authenticated_at: new Date().toISOString(),
      expires_at: expires,
      selected_driver_id: existing?.selected_driver_id ?? null,
      selected_driver_code: existing?.selected_driver_code ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "telegram_user_id" },
  );
}
export async function selectDriverSession(
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
export function helpText(session?: AdminSession | null) {
  if (!session) {
    return askPasswordOnceText() +
      "\n\n/logout — clear session\n/help — this message\n\nDriver groups: no slash menu; facility-arrival alerts only.\nLink a group with /link DRV-xxxx inside that group.";
  }
  const driverLine = session.selected_driver_code
    ? `Selected driver: ${session.selected_driver_code}`
    : "No driver selected yet — send DRV-xxxx when you need a lookup.";
  return [
    "Unlocked — password not needed again until /logout.",
    driverLine,
    "",
    "/menu — open buttons",
    "/status /updates /tour — driver lookups (need DRV selected)",
    "/driver DRV-xxxx — select / switch driver",
    "/logout — lock again",
    "",
    "Driver groups: no slash menu; facility-arrival alerts only.",
  ].join("\n");
}
export async function buildStatusText(sb: SupabaseClient, driverUuid: string) {
  const { data: driver } = await sb
    .from("drivers")
    .select("driver_id, first_name, last_name, status, trailer_id, assigned_truck")
    .eq("id", driverUuid)
    .maybeSingle();
  const { data: loads } = await sb
    .from("loads")
    .select(
      "load_id, load_status, trailer_id, tractor_id, pickup_location, delivery_location, delivery_date, status_bar_state, arrival_actual, arrival_scheduled",
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
    lines.push(
      `• ${l.load_id} [${l.load_status}] trailer=${l.trailer_id || "—"} tractor=${l.tractor_id || "—"} ${l.pickup_location || "—"} → ${l.delivery_location || "—"}`,
    );
  }
  return lines.join("\n");
}
export async function buildUpdatesText(sb: SupabaseClient, driverUuid: string) {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await sb
    .from("telegram_notification_history")
    .select("event_type, message, created_at")
    .eq("driver_id", driverUuid)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(12);
  if (!rows?.length) return "Facility arrivals (48h)\nNo recent notifications for this driver.";
  const lines = ["Facility arrivals (48h)", ""];
  for (const r of rows) {
    if (r.event_type === "payment_change") continue;
    lines.push(`• [${r.event_type}] ${String(r.message || "").replace(/\s+/g, " ").slice(0, 160)}`);
  }
  return lines.join("\n");
}
export async function buildTourText(sb: SupabaseClient, driverUuid: string) {
  const { data: driver } = await sb
    .from("drivers")
    .select("driver_id, first_name, last_name, trailer_id")
    .eq("id", driverUuid)
    .maybeSingle();
  const { data: loads } = await sb
    .from("loads")
    .select("load_id, load_status, trailer_id, tractor_id, pickup_location, delivery_location, pickup_date, delivery_date")
    .eq("driver_id", driverUuid)
    .not("load_status", "in", ACTIVE_LOAD_EXCLUDE)
    .order("delivery_date", { ascending: true })
    .limit(10);
  const lines = [
    `Tour — ${driver?.driver_id ?? "—"} ${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim(),
    "Active loads",
    `Trailer: ${driver?.trailer_id || "—"}`,
    `Count: ${(loads || []).length}`,
    "",
  ];
  if (!loads?.length) {
    lines.push("No matching loads.");
    return lines.join("\n");
  }
  for (const l of loads) {
    lines.push(
      `• ${l.load_id} [${l.load_status}] trailer=${l.trailer_id || "—"}`,
      `  ${l.pickup_location || "—"} → ${l.delivery_location || "—"}`,
    );
  }
  return lines.join("\n");
}
export async function requirePrivateAdmin(
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
    await reply(botToken, chatId, askPasswordOnceText());
    return null;
  }
  await touchSession(sb, userId);
  if (needDriver && !session.selected_driver_id) {
    await reply(botToken, chatId, "Unlocked. Send DRV-xxxx (or /driver DRV-xxxx) to look up a driver.");
    return null;
  }
  return session;
}
type AuthAttempt = "ok" | "wrong" | "unset" | "skip";
export async function tryAuthPassword(
  botToken: string,
  sb: SupabaseClient,
  chatId: string,
  userId: number,
  text: string,
): Promise<AuthAttempt> {
  const isAuthCmd = /^\/auth(?:@\w+)?(?:\s+|$)/i.test(text);
  const prior = await getSession(sb, userId);
  const locked = !prior;
  const looksLikePassword = isAuthCmd || (locked && !text.startsWith("/"));
  if (!looksLikePassword) return "skip";
  const password = adminPasswordConfigured();
  if (!password) return "unset";
  const candidate = isAuthCmd
    ? text.replace(/^\/auth(?:@\w+)?\s*/i, "").trim()
    : text.trim();
  if (!candidate) return isAuthCmd ? "wrong" : "skip";
  if (!timingSafeEqual(candidate, password)) return "wrong";
  await upsertAuthSession(sb, userId);
  const after = await getSession(sb, userId);
  if (prior && after?.selected_driver_id) {
    await reply(
      botToken,
      chatId,
      `Still unlocked. Driver ${after.selected_driver_code} is selected — use /menu freely.`,
      mainMenuKeyboard(),
    );
  } else {
    await reply(
      botToken,
      chatId,
      [
        "Unlocked. You stay unlocked — no password on every command.",
        "Send DRV-xxxx (or /driver DRV-xxxx) when you want driver data, then /menu.",
      ].join("\n"),
      mainMenuKeyboard(),
    );
  }
  return "ok";
}
export async function trySelectDriver(
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
export async function handleCallback(
  botToken: string,
  sb: SupabaseClient,
  cq: {
    id: string;
    data?: string;
    from?: { id?: number };
    message?: { chat?: { id?: number | string; type?: string; title?: string } };
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

  // Group: /link driver button
  if (data.startsWith("linkdrv:")) {
    const relayId = data.slice("linkdrv:".length);
    if (!relayId || relayId === "none") {
      await reply(botToken, chatId, "No Relay driver to link.");
      return;
    }
    const drivers = await listRelayDriversForLink(sb, 80);
    const name = drivers.find((d) => d.id === relayId)?.name || null;
    const { error } = await linkDriverGroup(
      sb,
      chatId,
      relayId,
      chat?.title || null,
      userId != null ? String(userId) : null,
      name,
    );
    if (error) {
      await reply(botToken, chatId, `Link failed: ${error.message}`);
      return;
    }
    await reply(
      botToken,
      chatId,
      `Linked to Relay driver <b>${name || relayId}</b>\n<code>${relayId}</code>\nAlerts for this driver go here. /whoami · /test · /unlink`,
      undefined,
      "HTML",
    );
    return;
  }

  if (!isPrivateChat(chat)) {
    await reply(botToken, chatId, "Admin menus are only available in a private chat with the bot.");
    return;
  }
  if (data === "menu:home" || data === "menu:help") {
    const session = userId != null ? await getSession(sb, userId) : null;
    if (data === "menu:home") {
      const s = await requirePrivateAdmin(botToken, sb, chatId, userId, false);
      if (!s) return;
      await reply(botToken, chatId, "Choose an option:", mainMenuKeyboard());
      return;
    }
    await reply(botToken, chatId, helpText(session), session ? mainMenuKeyboard() : undefined);
    return;
  }

  const session = await requirePrivateAdmin(botToken, sb, chatId, userId, false);
  if (!session) return;

  if (data === "menu:sync") {
    const { data: rows } = await sb
      .from("sync_state")
      .select("section, last_successful_sync_at, syncing, last_error")
      .order("section");
    const lines = ["📡 Sync status", ""];
    for (const r of rows || []) {
      lines.push(
        `${r.section}: ${r.syncing ? "syncing" : "idle"} · last ${r.last_successful_sync_at || "never"}${
          r.last_error ? ` · err ${r.last_error}` : ""
        }`,
      );
    }
    const envOn = ["1", "true", "yes", "on"].includes(
      (Deno.env.get("TELEGRAM_ALERTS_ENABLED") || "").trim().toLowerCase(),
    );
    lines.push("", `TELEGRAM_ALERTS_ENABLED: ${envOn ? "ON" : "OFF (default)"}`);
    await reply(botToken, chatId, lines.join("\n"), mainMenuKeyboard());
    return;
  }
  if (data === "menu:late") {
    const { data: trips } = await sb
      .from("relay_trips")
      .select("trip_id, driver_name_raw, section, status")
      .eq("archived", false)
      .in("section", ["UPCOMING", "IN_TRANSIT"])
      .limit(40);
    const lines = ["⏰ Late / active trips", ""];
    for (const t of trips || []) {
      lines.push(`• ${t.trip_id} [${t.section}] ${t.driver_name_raw || "no driver"} · ${t.status || "—"}`);
    }
    if (lines.length === 2) lines.push("None found.");
    await reply(botToken, chatId, lines.join("\n").slice(0, 3500), mainMenuKeyboard());
    return;
  }
  if (data === "menu:today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const { count } = await sb
      .from("relay_trips")
      .select("trip_id", { count: "exact", head: true })
      .gte("last_seen_at", start.toISOString());
    await reply(
      botToken,
      chatId,
      `📊 Today's stats\nTrips seen today: ${count ?? 0}\n(Kill switch stays OFF until you enable TELEGRAM_ALERTS_ENABLED.)`,
      mainMenuKeyboard(),
    );
    return;
  }
  if (data === "menu:find") {
    await reply(
      botToken,
      chatId,
      "Find trip: send /status <tripId> in a group or DM, or search in CRM Loads.",
      mainMenuKeyboard(),
    );
    return;
  }
  if (data === "menu:groups") {
    const { data: groups } = await sb
      .from("driver_groups")
      .select("chat_id, relay_driver_id, driver_name, active, group_title")
      .order("updated_at", { ascending: false })
      .limit(30);
    const lines = ["👥 Driver groups", ""];
    for (const g of groups || []) {
      lines.push(
        `${g.active ? "✓" : "·"} ${g.driver_name || g.relay_driver_id} · chat ${g.chat_id}${
          g.group_title ? ` (${g.group_title})` : ""
        }`,
      );
    }
    if (lines.length === 2) lines.push("None linked. In a group: /link then pick a driver.");
    await reply(botToken, chatId, lines.join("\n").slice(0, 3500), mainMenuKeyboard());
    return;
  }

  // Legacy driver-scoped buttons still work when a CRM driver is selected
  if (!session.selected_driver_id) {
    await reply(botToken, chatId, "Choose an option:", mainMenuKeyboard());
    return;
  }
  if (data === "menu:status") {
    await reply(botToken, chatId, await buildStatusText(sb, session.selected_driver_id), mainMenuKeyboard());
    return;
  }
  if (data === "menu:updates") {
    await reply(botToken, chatId, await buildUpdatesText(sb, session.selected_driver_id), mainMenuKeyboard());
    return;
  }
  if (data === "menu:tour") {
    await reply(botToken, chatId, await buildTourText(sb, session.selected_driver_id), mainMenuKeyboard());
  }
}
