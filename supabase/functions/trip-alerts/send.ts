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
  alerts_enabled: boolean;
};

export type AlertSetting = {
  alert_type: string;
  chat_id: string | null;
  enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
};

/** Env TELEGRAM_ALERTS_ENABLED default OFF. Unset/false → no automatic sends. */
export function isTelegramAlertsEnabled(config?: AlertConfig | null): boolean {
  const v = (Deno.env.get("TELEGRAM_ALERTS_ENABLED") || "").trim().toLowerCase();
  const envOn = v === "1" || v === "true" || v === "yes" || v === "on";
  if (!envOn) return false;
  // DB mirror also defaults false; both must allow automatic sends.
  if (config && config.alerts_enabled === false) return false;
  return true;
}

const ALWAYS_ALERT = new Set(["not_at_stop", "cpt_risk"]);

/** Per-chat send throttle: max 1 msg / 3s. */
const lastSendAtByChat = new Map<string, number>();
const MIN_GAP_MS = 3000;

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
    alerts_enabled: Boolean(data?.alerts_enabled),
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

/** Fallback dispatch chat (legacy). Prefer driver_groups. */
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
    TELEGRAM_ALERTS_ENABLED: isTelegramAlertsEnabled(),
  };
}

/** Resolve chat_ids for a trip from driver_groups (Relay driverList[].id). */
export async function resolveDriverGroupChats(
  sb: SupabaseClient,
  relayDriverIds: string[],
): Promise<string[]> {
  const ids = [...new Set(relayDriverIds.map((x) => String(x || "").trim()).filter(Boolean))];
  if (!ids.length) return [];
  const { data } = await sb
    .from("driver_groups")
    .select("chat_id, relay_driver_id")
    .in("relay_driver_id", ids)
    .eq("active", true);
  return [...new Set((data || []).map((r) => String(r.chat_id)).filter(Boolean))];
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
  chatId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("alerts_sent")
    .select("id")
    .eq("trip_id", tripId)
    .eq("stop_id", stopId || "")
    .eq("alert_type", alertType)
    .eq("level", level)
    .eq("chat_id", chatId || "")
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

async function throttleChat(chatId: string): Promise<void> {
  const last = lastSendAtByChat.get(chatId) || 0;
  const wait = MIN_GAP_MS - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export async function sendTelegramHtml(
  botToken: string,
  chatId: string,
  html: string,
  opts?: {
    replyTo?: number | null;
    replyMarkup?: Record<string, unknown>;
    /** Bypass kill switch (interactive /test only). */
    force?: boolean;
    config?: AlertConfig | null;
  },
): Promise<{ ok: boolean; messageId?: number; error?: string; skipped?: boolean }> {
  if (!opts?.force && !isTelegramAlertsEnabled(opts?.config)) {
    return { ok: false, skipped: true, error: "TELEGRAM_ALERTS_ENABLED is OFF" };
  }

  await throttleChat(chatId);

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: html.slice(0, 3900),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (opts?.replyTo) body.reply_to_message_id = opts.replyTo;
  if (opts?.replyMarkup) body.reply_markup = opts.replyMarkup;

  const attempt = async (): Promise<{ ok: boolean; messageId?: number; error?: string }> => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const retryAfter = Number(json?.parameters?.retry_after || 3);
        await new Promise((r) => setTimeout(r, Math.max(1, retryAfter) * 1000));
        const retry = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const retryJson = await retry.json().catch(() => ({}));
        if (!retry.ok || !retryJson?.ok) {
          return { ok: false, error: JSON.stringify(retryJson).slice(0, 500) };
        }
        lastSendAtByChat.set(chatId, Date.now());
        return { ok: true, messageId: Number(retryJson.result?.message_id) };
      }
      if (!res.ok || !json?.ok) {
        return { ok: false, error: JSON.stringify(json).slice(0, 500) };
      }
      lastSendAtByChat.set(chatId, Date.now());
      return { ok: true, messageId: Number(json.result?.message_id) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  };

  return attempt();
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
  /** Relay driverList[].id values — team trips fan out to each linked group. */
  relayDriverIds?: string[];
  /** Explicit chat override (e.g. /test in a linked group). */
  chatIds?: string[];
};

async function sendOneChat(
  sb: SupabaseClient,
  botToken: string,
  config: AlertConfig,
  settings: Map<string, AlertSetting>,
  alert: OutgoingAlert,
  chatId: string,
): Promise<{ status: string; error?: string; messageId?: number; chatId?: string }> {
  if (!alert.force && inQuietHours(alert.alertType, settings, config)) {
    return { status: "quiet_hours", chatId };
  }
  if (await isMuted(sb, alert.tripId, chatId)) {
    return { status: "muted", chatId };
  }
  if (
    !alert.force &&
    (await alreadySent(sb, alert.tripId, alert.stopId || "", alert.alertType, alert.level, chatId))
  ) {
    return { status: "deduped", chatId };
  }

  const replyTo = await lastTripMessageId(sb, alert.tripId, chatId);
  const sent = await sendTelegramHtml(botToken, chatId, alert.html, {
    replyTo,
    replyMarkup: openCrmKeyboard(crmUrl(config, alert.tripId)),
    force: alert.force,
    config,
  });
  if (sent.skipped) {
    return { status: "kill_switch_off", chatId, error: sent.error };
  }
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
      { onConflict: "trip_id,stop_id,alert_type,level,chat_id" },
    );
  } else {
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

export async function dispatchAlert(
  sb: SupabaseClient,
  botToken: string,
  config: AlertConfig,
  settings: Map<string, AlertSetting>,
  alert: OutgoingAlert,
): Promise<{ status: string; error?: string; messageId?: number; chatId?: string; results?: unknown[] }> {
  const setting = settings.get(alert.alertType);
  if (setting && setting.enabled === false && !alert.force) {
    return { status: "disabled" };
  }

  // Kill switch: block automatic sends; /test (force) still allowed.
  if (!alert.force && !isTelegramAlertsEnabled(config)) {
    return { status: "kill_switch_off", error: "TELEGRAM_ALERTS_ENABLED is OFF" };
  }

  let chatIds: string[] = [];
  if (alert.chatIds?.length) {
    chatIds = [...new Set(alert.chatIds.filter(Boolean))];
  } else if (alert.relayDriverIds?.length) {
    chatIds = await resolveDriverGroupChats(sb, alert.relayDriverIds);
  }
  if (!chatIds.length) {
    const fallback = resolveChatId(alert.alertType, settings, config);
    if (fallback) chatIds = [fallback];
  }
  if (!chatIds.length) {
    return { status: "no_chat", error: "No driver_groups chat and no fallback dispatch chat" };
  }

  const results = [];
  for (const chatId of chatIds) {
    results.push(await sendOneChat(sb, botToken, config, settings, alert, chatId));
  }
  const firstOk = results.find((r) => r.status === "sent") || results[0];
  return { ...firstOk, results };
}
