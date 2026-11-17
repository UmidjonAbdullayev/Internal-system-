import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Relay-Extension-Key",
};

export const SECTION_OK = new Set(["IN_TRANSIT", "UPCOMING", "HISTORY"]);
export const LIVE_SECTIONS = new Set(["IN_TRANSIT", "UPCOMING"]);
export const REMOVED_AFTER_MS = 10 * 60 * 1000;
export const PAUSE_MS = 5 * 60 * 1000;

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function requireExtensionKey(req: Request): string | Response {
  const expected = Deno.env.get("RELAY_EXTENSION_API_KEY");
  if (!expected) {
    return json({ success: false, error: "Server missing RELAY_EXTENSION_API_KEY" }, 500);
  }
  const provided = req.headers.get("X-Relay-Extension-Key") || "";
  if (!provided || provided !== expected) {
    return json({ success: false, error: "Unauthorized extension key" }, 401);
  }
  return expected;
}

export function isValidRelayId(id: unknown): boolean {
  if (id == null) return false;
  const s = String(id).trim();
  if (!s || s.length < 6 || s.length > 40 || /\s/.test(s)) return false;
  return /^T-[A-Z0-9]{5,}$/i.test(s) || /^[0-9]{2,3}[A-Z0-9]{5,}$/i.test(s);
}

export function normalizeSection(raw: unknown): string | null {
  const s = String(raw || "").toUpperCase().replace(/-/g, "_");
  if (s === "INTRANSIT") return "IN_TRANSIT";
  if (SECTION_OK.has(s)) return s;
  return null;
}

export function sanitizeDriverName(raw: unknown): string | null {
  if (raw == null) return null;
  const firstLine = String(raw).split(/\n/)[0].replace(/\s+/g, " ").trim();
  if (!firstLine || firstLine.length < 3 || firstLine.length > 60) return null;
  if (/\d/.test(firstLine) || /,\s*[A-Z]{2}\b/.test(firstLine)) return null;
  return firstLine;
}

export async function markSyncAttempt(
  sb: SupabaseClient,
  section: string,
  patch: Record<string, unknown>,
) {
  await sb.from("sync_state").upsert(
    {
      section,
      updated_at: new Date().toISOString(),
      ...patch,
    },
    { onConflict: "section" },
  );
}

export async function resolveDispatchChatId(sb: SupabaseClient): Promise<string | null> {
  const { data: settings } = await sb
    .from("telegram_alert_settings")
    .select("chat_id")
    .eq("alert_type", "sync_restored")
    .maybeSingle();
  if (settings?.chat_id) return String(settings.chat_id);

  const { data: cfg } = await sb
    .from("telegram_alert_config")
    .select("default_chat_id")
    .eq("id", 1)
    .maybeSingle();
  if (cfg?.default_chat_id) return String(cfg.default_chat_id);

  return (
    Deno.env.get("TELEGRAM_DISPATCH_CHAT_ID") ||
    Deno.env.get("TELEGRAM_OPS_CHAT_ID") ||
    Deno.env.get("TELEGRAM_CHAT_ID") ||
    null
  );
}

export async function sendRestoreSummary(
  sb: SupabaseClient,
  summary: {
    found: number;
    removed: number;
    gapStart: string | null;
    gapEnd: string | null;
  },
): Promise<{ sent: boolean; error?: string }> {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) return { sent: false, error: "no_bot_token" };
  const chatId = await resolveDispatchChatId(sb);
  if (!chatId) return { sent: false, error: "no_chat_id" };

  const gapMins =
    summary.gapStart && summary.gapEnd
      ? Math.max(
        1,
        Math.round(
          (Date.parse(summary.gapEnd) - Date.parse(summary.gapStart)) / 60000,
        ),
      )
      : null;
  const lines = [
    `<b>Sync restored</b> · Relay catch-up done`,
    gapMins != null
      ? `Gap ~${gapMins}m · found ${summary.found} · review ${summary.removed}`
      : `Found ${summary.found} · review ${summary.removed}`,
    `No overdue alerts for resolved gap`,
  ];
  const text = lines.join("\n").slice(0, 900);

  try {
    const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!tg.ok) return { sent: false, error: await tg.text() };

    await sb.from("alerts_sent").upsert(
      {
        trip_id: "_sync_",
        stop_id: "",
        alert_type: "sync_restored",
        level: "catch_up",
        chat_id: chatId,
        meta: summary,
      },
      { onConflict: "trip_id,stop_id,alert_type,level", ignoreDuplicates: true },
    ).catch(() => null);

    return { sent: true };
  } catch (err) {
    return { sent: false, error: String(err) };
  }
}

