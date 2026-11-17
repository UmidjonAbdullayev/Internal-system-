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

/** Spec: NO automatic system messages (sync restored / catch-up). Always no-op. */
export async function sendRestoreSummary(
  _sb: SupabaseClient,
  _summary: {
    found: number;
    removed: number;
    gapStart: string | null;
    gapEnd: string | null;
  },
): Promise<{ sent: boolean; error?: string }> {
  return { sent: false, error: "system_messages_disabled" };
}

