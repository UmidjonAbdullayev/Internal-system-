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
};

/** Env TELEGRAM_ALERTS_ENABLED default OFF. Unset/false → no automatic sends. */
export function isTelegramAlertsEnabled(config?: AlertConfig | null): boolean {
  const v = (Deno.env.get("TELEGRAM_ALERTS_ENABLED") || "").trim().toLowerCase();
  const envOn = v === "1" || v === "true" || v === "yes" || v === "on";
  if (!envOn) return false;
  if (config && config.alerts_enabled === false) return false;
  return true;
}

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
    map.set(row.alert_type, {
      alert_type: row.alert_type,
      chat_id: row.chat_id ?? null,
      enabled: Boolean(row.enabled),
    });
  }
  return map;
}

export function chatSourcesPresent(): Record<string, boolean> {
  return {
    TELEGRAM_ALERTS_ENABLED: isTelegramAlertsEnabled(),
  };
}

export function crmUrl(config: AlertConfig, tripId: string): string {
  const base = (config.crm_base_url || "https://internal-system-lac.vercel.app").replace(/\/$/, "");
  return `${base}/loads?q=${encodeURIComponent(tripId)}`;
}

export function openCrmKeyboard(url: string) {
  return { inline_keyboard: [[{ text: "Open in CRM", url }]] };
}

export type DriverGroupChat = {
  chat_id: string;
  driver_id: string | null;
  relay_driver_id: string | null;
  driver_name: string | null;
  group_title: string | null;
  alerts_enabled: boolean;
  quiet: boolean;
};

function mapGroupRow(r: Record<string, unknown>): DriverGroupChat {
  return {
    chat_id: String(r.chat_id),
    driver_id: r.driver_id ? String(r.driver_id) : null,
    relay_driver_id: r.relay_driver_id ? String(r.relay_driver_id) : null,
    driver_name: r.driver_name ? String(r.driver_name) : null,
    group_title: r.group_title ? String(r.group_title) : null,
    alerts_enabled: Boolean(r.alerts_enabled),
    quiet: Boolean(r.quiet),
  };
}

/** Resolve linked groups for CRM driver ids and/or Relay driver ids. */
export async function resolveDriverGroupChats(
  sb: SupabaseClient,
  opts: { crmDriverIds?: string[]; relayDriverIds?: string[] },
): Promise<DriverGroupChat[]> {
  const crm = [...new Set((opts.crmDriverIds || []).map((x) => String(x || "").trim()).filter(Boolean))];
  const relay = [...new Set((opts.relayDriverIds || []).map((x) => String(x || "").trim()).filter(Boolean))];
  const out = new Map<string, DriverGroupChat>();
  const cols = "chat_id, driver_id, relay_driver_id, driver_name, group_title, alerts_enabled, quiet";

  if (crm.length) {
    const { data } = await sb.from("driver_groups").select(cols).in("driver_id", crm).eq("active", true);
    for (const r of data || []) out.set(String(r.chat_id), mapGroupRow(r as Record<string, unknown>));
  }
  if (relay.length) {
    const { data } = await sb
      .from("driver_groups")
      .select(cols)
      .in("relay_driver_id", relay)
      .eq("active", true);
    for (const r of data || []) out.set(String(r.chat_id), mapGroupRow(r as Record<string, unknown>));
  }
  return [...out.values()];
}

async function throttleChat(chatId: string): Promise<void> {
  const last = lastSendAtByChat.get(chatId) || 0;
  const wait = MIN_GAP_MS - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export type SendTelegramOpts = {
  replyTo?: number | null;
  replyMarkup?: Record<string, unknown>;
  /** /test samples only — bypasses kill switch. */
  force?: boolean;
  config?: AlertConfig | null;
};

/**
 * ONLY alert send path. Kill switch checked here.
 * Webhook command replies use a separate reply() helper (not alerts).
 */
export async function sendTelegram(
  botToken: string,
  chatId: string,
  html: string,
  opts?: SendTelegramOpts,
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

/** @deprecated alias — all alert code must use sendTelegram */
export const sendTelegramHtml = sendTelegram;

export type OutgoingAlert = {
  tripId: string;
  stopId?: string;
  alertType: "arrived" | "not_at_stop" | string;
  html: string;
  meta?: Record<string, unknown>;
  force?: boolean;
  dryRun?: boolean;
  reason?: string;
  syncBasis?: string;
  crmDriverIds?: string[];
  relayDriverIds?: string[];
  chatIds?: string[];
  /** Reply to prior not_at_stop for this stop when sending arrived. */
  replyToStopAlert?: boolean;
};

async function claimAlertSlot(
  sb: SupabaseClient,
  tripId: string,
  stopId: string,
  alertType: string,
  chatId: string,
  meta: Record<string, unknown>,
): Promise<{ claimed: boolean; id?: string }> {
  const { data, error } = await sb
    .from("alerts_sent")
    .insert({
      trip_id: tripId,
      stop_id: stopId || "",
      alert_type: alertType,
      level: "0",
      chat_id: chatId,
      meta,
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (error) {
    // unique violation → already claimed
    if (String(error.code) === "23505" || /duplicate|unique/i.test(error.message || "")) {
      return { claimed: false };
    }
    return { claimed: false };
  }
  return { claimed: Boolean(data?.id), id: data?.id ? String(data.id) : undefined };
}

async function notAtStopMessageId(
  sb: SupabaseClient,
  tripId: string,
  stopId: string,
  chatId: string,
): Promise<number | null> {
  const { data } = await sb
    .from("alerts_sent")
    .select("telegram_message_id")
    .eq("trip_id", tripId)
    .eq("stop_id", stopId || "")
    .eq("alert_type", "not_at_stop")
    .eq("chat_id", chatId)
    .not("telegram_message_id", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.telegram_message_id != null ? Number(data.telegram_message_id) : null;
}

/**
 * At most one dry-run row per (trip, stop, alert_type, chat).
 * chat_id null = unlinked candidate (still one row).
 */
export async function writeDryRun(
  sb: SupabaseClient,
  row: {
    tripId: string;
    stopId?: string;
    alertType: string;
    chatId?: string | null;
    driverId?: string | null;
    html: string;
    meta?: Record<string, unknown>;
    reason?: string;
    syncBasis?: string;
  },
): Promise<{ written: boolean }> {
  const stopId = row.stopId || "";
  const chatId = row.chatId || null;
  let q = sb
    .from("dry_run_alerts")
    .select("id")
    .eq("trip_id", row.tripId)
    .eq("stop_id", stopId)
    .eq("alert_type", row.alertType)
    .limit(1);
  q = chatId == null ? q.is("chat_id", null) : q.eq("chat_id", chatId);
  const { data: existing } = await q.maybeSingle();
  if (existing?.id) return { written: false };

  const { error } = await sb.from("dry_run_alerts").insert({
    trip_id: row.tripId,
    stop_id: stopId,
    alert_type: row.alertType,
    chat_id: chatId,
    driver_id: row.driverId || null,
    html: row.html,
    meta: row.meta || {},
    reason: row.reason || null,
    sync_basis: row.syncBasis || null,
    would_send_at: new Date().toISOString(),
  });
  if (error) {
    if (String(error.code) === "23505" || /duplicate|unique/i.test(error.message || "")) {
      return { written: false };
    }
  }
  return { written: !error };
}

async function sendOneChat(
  sb: SupabaseClient,
  botToken: string,
  config: AlertConfig,
  alert: OutgoingAlert,
  group: DriverGroupChat | {
    chat_id: string;
    driver_id?: string | null;
    driver_name?: string | null;
    group_title?: string | null;
    alerts_enabled?: boolean;
    quiet?: boolean;
  },
): Promise<{ status: string; error?: string; messageId?: number; chatId?: string; dryRun?: boolean }> {
  const chatId = group.chat_id;
  if (group.quiet && !alert.force) {
    return { status: "quiet", chatId };
  }

  const previewMeta = {
    ...(alert.meta || {}),
    driver: group.driver_name || alert.meta?.driver || null,
    group_title: group.group_title || null,
    chat_id: chatId,
  };

  // Dry-run or kill switch OFF → log would-send, never Bot API (except /test force)
  const killOff = !isTelegramAlertsEnabled(config);
  if (alert.dryRun || (killOff && !alert.force)) {
    const wr = await writeDryRun(sb, {
      tripId: alert.tripId,
      stopId: alert.stopId,
      alertType: alert.alertType,
      chatId,
      driverId: group.driver_id || null,
      html: alert.html,
      meta: previewMeta,
      reason: alert.reason || (killOff ? "kill_switch_off" : "dry_run"),
      syncBasis: alert.syncBasis,
    });
    return { status: wr.written ? "dry_run" : "deduped", chatId, dryRun: true };
  }

  // Live send also requires per-group enable (pilot) unless force/test
  if (!alert.force && group.alerts_enabled === false) {
    await writeDryRun(sb, {
      tripId: alert.tripId,
      stopId: alert.stopId,
      alertType: alert.alertType,
      chatId,
      driverId: group.driver_id || null,
      html: alert.html,
      meta: { ...previewMeta, blocked: "group_disabled" },
      reason: "group_alerts_disabled",
      syncBasis: alert.syncBasis,
    });
    return { status: "group_disabled", chatId };
  }

  const claim = await claimAlertSlot(
    sb,
    alert.tripId,
    alert.stopId || "",
    alert.alertType,
    chatId,
    alert.meta || {},
  );
  if (!claim.claimed && !alert.force) {
    return { status: "deduped", chatId };
  }

  let replyTo: number | null = null;
  if (alert.replyToStopAlert && alert.alertType === "arrived") {
    replyTo = await notAtStopMessageId(sb, alert.tripId, alert.stopId || "", chatId);
  }

  const sent = await sendTelegram(botToken, chatId, alert.html, {
    replyTo,
    replyMarkup: openCrmKeyboard(crmUrl(config, alert.tripId)),
    force: alert.force,
    config,
  });

  if (sent.skipped) {
    return { status: "kill_switch_off", chatId, error: sent.error };
  }
  if (!sent.ok) {
    return { status: "failed", error: sent.error, chatId };
  }

  if (claim.id) {
    await sb
      .from("alerts_sent")
      .update({ telegram_message_id: sent.messageId ?? null })
      .eq("id", claim.id);
  } else if (alert.force) {
    await sb.from("alerts_sent").insert({
      trip_id: alert.tripId,
      stop_id: alert.stopId || "",
      alert_type: alert.alertType,
      level: `test:${Date.now()}`,
      chat_id: chatId,
      telegram_message_id: sent.messageId ?? null,
      meta: { ...(alert.meta || {}), test: true },
      sent_at: new Date().toISOString(),
    });
  }

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

  let groups: Array<DriverGroupChat | { chat_id: string; driver_id?: string | null; alerts_enabled?: boolean; quiet?: boolean }> = [];

  if (alert.chatIds?.length) {
    groups = alert.chatIds.filter(Boolean).map((chat_id) => ({
      chat_id,
      driver_id: null,
      alerts_enabled: true,
      quiet: false,
    }));
  } else {
    groups = await resolveDriverGroupChats(sb, {
      crmDriverIds: alert.crmDriverIds,
      relayDriverIds: alert.relayDriverIds,
    });
  }

  if (!groups.length) {
    // Still dry-run log with null chat so Alert preview shows unlinked candidates
    if (alert.dryRun || !isTelegramAlertsEnabled(config)) {
      const wr = await writeDryRun(sb, {
        tripId: alert.tripId,
        stopId: alert.stopId,
        alertType: alert.alertType,
        chatId: null,
        driverId: alert.crmDriverIds?.[0] || null,
        html: alert.html,
        meta: {
          ...(alert.meta || {}),
          driver: alert.meta?.driver || null,
          group_title: null,
          chat_id: null,
        },
        reason: alert.reason || "no_linked_group",
        syncBasis: alert.syncBasis,
      });
      return { status: wr.written ? "dry_run_no_chat" : "deduped" };
    }
    return { status: "no_chat", error: "No linked driver_groups for this trip" };
  }

  const results = [];
  for (const g of groups) {
    results.push(await sendOneChat(sb, botToken, config, alert, g));
  }
  const firstOk = results.find((r) => r.status === "sent" || r.status === "dry_run") || results[0];
  return { ...firstOk, results };
}
