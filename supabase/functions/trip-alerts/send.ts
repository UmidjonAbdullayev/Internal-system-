import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type AlertConfig = {
  default_chat_id: string | null;
  bootstrapped: boolean;
  sync_stale_notified: boolean;
  cron_secret: string;
  crm_base_url: string;
  timezone: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
};

export type AlertSetting = {
  alert_type: string;
  chat_id: string | null;
  enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
};

const ALWAYS_ALERT = new Set([
  "not_at_stop",
  "cpt_risk",
  "sync_stopped",
  "sync_restored",
]);

export async function loadConfig(sb: SupabaseClient): Promise<AlertConfig> {
  const { data } = await sb.from("telegram_alert_config").select("*").eq("id", 1).maybeSingle();
  return {
    default_chat_id: data?.default_chat_id ?? null,
    bootstrapped: Boolean(data?.bootstrapped),
    sync_stale_notified: Boolean(data?.sync_stale_notified),
    cron_secret: String(data?.cron_secret || ""),
    crm_base_url: String(data?.crm_base_url || "https://internal-system-lac.vercel.app"),
    timezone: String(data?.timezone || "America/Chicago"),
    quiet_hours_start: data?.quiet_hours_start ?? null,
    quiet_hours_end: data?.quiet_hours_end ?? null,
  };
}

export async function loadSettings(sb: SupabaseClient): Promise<Map<string, AlertSetting>> {
  const { data } = await sb.from("telegram_alert_settings").select("*");
  const map = new Map<string, AlertSetting>();
  for (const row of data || []) {
    map.set(row.alert_type, row as AlertSetting);
  }
  return map;
}

/** Never invent chat ids — only env / settings / config. */
export function resolveChatId(
  alertType: string,
  settings: Map<string, AlertSetting>,
  config: AlertConfig,
): string | null {
  const row = settings.get(alertType);
  const fromRow = row?.chat_id?.trim();
  if (fromRow) return fromRow;
  if (config.default_chat_id?.trim()) return config.default_chat_id.trim();
  const env =
    Deno.env.get("TELEGRAM_DISPATCH_CHAT_ID") ||
    Deno.env.get("TELEGRAM_OPS_CHAT_ID") ||
    Deno.env.get("TELEGRAM_CHAT_ID") ||
    "";
  return env.trim() || null;
}

export function chatSourcesPresent(): Record<string, boolean> {
  return {
    TELEGRAM_DISPATCH_CHAT_ID: Boolean(Deno.env.get("TELEGRAM_DISPATCH_CHAT_ID")),
    TELEGRAM_OPS_CHAT_ID: Boolean(Deno.env.get("TELEGRAM_OPS_CHAT_ID")),
    TELEGRAM_CHAT_ID: Boolean(Deno.env.get("TELEGRAM_CHAT_ID")),
  };
}

function parseHHMM(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function inQuietHours(
  alertType: string,
  settings: Map<string, AlertSetting>,
  config: AlertConfig,
  now = new Date(),
): boolean {
  if (ALWAYS_ALERT.has(alertType)) return false;
  const row = settings.get(alertType);
  const start = parseHHMM(row?.quiet_hours_start ?? config.quiet_hours_start);
  const end = parseHHMM(row?.quiet_hours_end ?? config.quiet_hours_end);
  if (start == null || end == null) return false;
  const tz = row?.timezone || config.timezone || "America/Chicago";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  const mins = hour * 60 + minute;
  if (start <= end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

export async function isMuted(
  sb: SupabaseClient,
  tripId: string,
  chatId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("telegram_trip_mutes")
    .select("muted_until")
    .eq("trip_id", tripId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!data?.muted_until) return false;
  return new Date(data.muted_until).getTime() > Date.now();
}

export async function alreadySent(
  sb: SupabaseClient,
  tripId: string,
  stopId: string,
  alertType: string,
  level: string,
): Promise<boolean> {
  const { data } = await sb
    .from("alerts_sent")
    .select("id")
    .eq("trip_id", tripId)
    .eq("stop_id", stopId || "")
    .eq("alert_type", alertType)
    .eq("level", level)
    .maybeSingle();
  return Boolean(data);
}

export async function lastTripMessageId(
  sb: SupabaseClient,
  tripId: string,
  chatId: string,
): Promise<number | null> {
  const { data } = await sb
    .from("alerts_sent")
    .select("telegram_message_id")
    .eq("trip_id", tripId)
    .eq("chat_id", chatId)
    .not("telegram_message_id", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.telegram_message_id != null ? Number(data.telegram_message_id) : null;
}

export function crmUrl(config: AlertConfig, tripId: string): string {
  const base = (config.crm_base_url || "https://internal-system-lac.vercel.app").replace(/\/$/, "");
  return `${base}/loads?q=${encodeURIComponent(tripId)}`;
}

export function openCrmKeyboard(url: string) {
  return {
    inline_keyboard: [[{ text: "Open in CRM", url }]],
  };
}

export async function sendTelegramHtml(
  botToken: string,
  chatId: string,
  html: string,
  opts?: { replyTo?: number | null; replyMarkup?: Record<string, unknown> },
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: html.slice(0, 3900),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (opts?.replyTo) body.reply_to_message_id = opts.replyTo;
  if (opts?.replyMarkup) body.reply_markup = opts.replyMarkup;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      return { ok: false, error: JSON.stringify(json).slice(0, 500) };
    }
    return { ok: true, messageId: Number(json.result?.message_id) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export type OutgoingAlert = {
  tripId: string;
  stopId?: string;
  alertType: string;
  level: string;
  html: string;
  emoji?: string;
  meta?: Record<string, unknown>;
  force?: boolean;
};

export async function dispatchAlert(
  sb: SupabaseClient,
  botToken: string,
  config: AlertConfig,
  settings: Map<string, AlertSetting>,
  alert: OutgoingAlert,
): Promise<{ status: string; error?: string; messageId?: number; chatId?: string }> {
  const setting = settings.get(alert.alertType);
  if (setting && setting.enabled === false) {
    return { status: "disabled" };
  }
  const chatId = resolveChatId(alert.alertType, settings, config);
  if (!chatId) {
    return { status: "no_chat", error: "No dispatch chat_id in settings/config/env" };
  }
  if (!alert.force && inQuietHours(alert.alertType, settings, config)) {
    return { status: "quiet_hours", chatId };
  }
  if (await isMuted(sb, alert.tripId, chatId)) {
    return { status: "muted", chatId };
  }
  if (
    !alert.force &&
    (await alreadySent(sb, alert.tripId, alert.stopId || "", alert.alertType, alert.level))
  ) {
    return { status: "deduped", chatId };
  }

  const replyTo = await lastTripMessageId(sb, alert.tripId, chatId);
  const sent = await sendTelegramHtml(botToken, chatId, alert.html, {
    replyTo,
    replyMarkup: openCrmKeyboard(crmUrl(config, alert.tripId)),
  });
  if (!sent.ok) {
    await sb.from("telegram_notification_history").insert({
      telegram_chat_id: chatId,
      driver_id: null,
      event_type: `trip_alert:${alert.alertType}`,
      dedupe_key: `${alert.alertType}:${alert.tripId}:${alert.stopId || ""}:${alert.level}`.slice(0, 200),
      message: alert.html,
      status: "failed",
      error: sent.error,
      meta: alert.meta || {},
    });
    return { status: "failed", error: sent.error, chatId };
  }

  if (!alert.force) {
    await sb.from("alerts_sent").upsert(
      {
        trip_id: alert.tripId,
        stop_id: alert.stopId || "",
        alert_type: alert.alertType,
        level: alert.level,
        sent_at: new Date().toISOString(),
        telegram_message_id: sent.messageId ?? null,
        chat_id: chatId,
        meta: alert.meta || {},
      },
      { onConflict: "trip_id,stop_id,alert_type,level" },
    );
  } else {
    // TEST sends still record history but use unique level so they don't block live
    await sb.from("alerts_sent").insert({
      trip_id: alert.tripId,
      stop_id: alert.stopId || "",
      alert_type: alert.alertType,
      level: `test:${Date.now()}`,
      sent_at: new Date().toISOString(),
      telegram_message_id: sent.messageId ?? null,
      chat_id: chatId,
      meta: { ...(alert.meta || {}), test: true },
    });
  }

  await sb.from("telegram_notification_history").insert({
    telegram_chat_id: chatId,
    driver_id: null,
    event_type: `trip_alert:${alert.alertType}`,
    dedupe_key: `${alert.alertType}:${alert.tripId}:${alert.level}:${sent.messageId}`.slice(0, 200),
    message: alert.html,
    status: "sent",
    meta: { ...(alert.meta || {}), level: alert.level, test: Boolean(alert.force) },
  });

  return { status: "sent", messageId: sent.messageId, chatId };
}
