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

/** True when tourState itself is cancelled (not status / executionStatus alone). */
export function tourStateCancelled(tourState?: unknown): boolean {
  return /cancel/.test(String(tourState || "").toLowerCase());
}

/** True when every nested load/leg is cancelled. Empty legs → false. */
export function allLegsCancelledFromLegs(
  legs: { executionStatus?: unknown; status?: unknown }[] | null | undefined,
): boolean {
  if (!legs?.length) return false;
  return legs.every((leg) => {
    const st = String(leg.executionStatus || leg.status || "").toLowerCase();
    return /cancel/.test(st);
  });
}

/**
 * Fully cancelled → ALWAYS section=HISTORY (Cancelled), whatever Relay tab
 * the trip arrived on. tourState cancelled OR every load CANCELLED.
 * One cancelled leg does NOT cancel the trip. Derived status (Delivered) is ignored.
 * Partial cancels keep live-tab membership (#44).
 */
export function isFullyCancelledTrip(
  tourState: unknown,
  legs?: { executionStatus?: unknown; status?: unknown }[] | null,
): boolean {
  return tourStateCancelled(tourState) || allLegsCancelledFromLegs(legs);
}

/** @deprecated Prefer isFullyCancelledTrip — status/execution blob alone must not force History. */
export function looksCancelled(
  status: unknown,
  tourState?: unknown,
  executionStatus?: unknown,
): boolean {
  if (tourStateCancelled(tourState)) return true;
  const blob = `${status || ""} ${executionStatus || ""}`.toLowerCase();
  return /cancel/.test(blob);
}

export async function recordTripEvent(
  sb: SupabaseClient,
  row: {
    trip_id: string;
    event_type: string;
    from_section?: string | null;
    to_section?: string | null;
    from_status?: string | null;
    to_status?: string | null;
    detail?: Record<string, unknown>;
  },
) {
  await sb
    .from("trip_events")
    .insert({
      trip_id: row.trip_id,
      event_type: row.event_type,
      from_section: row.from_section ?? null,
      to_section: row.to_section ?? null,
      from_status: row.from_status ?? null,
      to_status: row.to_status ?? null,
      detail: row.detail ?? {},
    })
    .then(() => null, () => null);
}

/** Status blob that can flip money_bucket (COMPLETED / TONU / cancel+payout). */
export function incomeStatusSignal(
  status: unknown,
  executionStatus?: unknown,
  payout?: unknown,
): string {
  const st = String(status || "").toUpperCase();
  const ex = String(executionStatus || "").toUpperCase();
  const paid = Number(payout) || 0;
  if (st.includes("TONU") || ex.includes("TONU")) return "tonu";
  if (paid > 0 && (st.includes("CANCEL") || ex.includes("CANCEL"))) return "tonu_cancel_payout";
  if (st === "COMPLETED" || st.includes("COMPLET") || ex.includes("COMPLET")) return "completed";
  if (st.includes("CANCEL") || ex.includes("CANCEL")) return "cancelled_zero";
  if (st === "REMOVED_FROM_RELAY") return "removed_from_relay";
  return st || "unknown";
}

/**
 * Guardrail: any sync/cleanup that changes income-relevant status must write trip_events.
 * Call whenever status (or cancel/payout signal) changes.
 */
export async function recordIncomeStatusChange(
  sb: SupabaseClient,
  opts: {
    trip_id: string;
    from_status: string | null | undefined;
    to_status: string | null | undefined;
    from_execution?: string | null;
    to_execution?: string | null;
    payout?: number | null;
    reason: string;
    code_path: string;
    from_section?: string | null;
    to_section?: string | null;
  },
) {
  const fromSig = incomeStatusSignal(opts.from_status, opts.from_execution, opts.payout);
  const toSig = incomeStatusSignal(opts.to_status, opts.to_execution, opts.payout);
  const statusChanged = String(opts.from_status || "") !== String(opts.to_status || "");
  if (!statusChanged && fromSig === toSig) return;
  await recordTripEvent(sb, {
    trip_id: opts.trip_id,
    event_type: "income_status_change",
    from_section: opts.from_section ?? null,
    to_section: opts.to_section ?? null,
    from_status: opts.from_status ?? null,
    to_status: opts.to_status ?? null,
    detail: {
      reason: opts.reason,
      code_path: opts.code_path,
      from_signal: fromSig,
      to_signal: toSig,
      from_execution: opts.from_execution ?? null,
      to_execution: opts.to_execution ?? null,
      payout: opts.payout ?? null,
    },
  });
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

/** Mark extension alive — used by dedicated heartbeat and successful sync pushes. */
export async function touchExtensionAlive(
  sb: SupabaseClient,
  opts: {
    now: string;
    authStatus?: string;
    clientId?: string | null;
    detail?: string | null;
  },
) {
  const authStatus = ["ok", "auth_required", "unknown"].includes(String(opts.authStatus || ""))
    ? String(opts.authStatus)
    : "ok";
  await sb.from("extension_heartbeat").upsert(
    {
      id: 1,
      alive_at: opts.now,
      auth_status: authStatus,
      client_id: opts.clientId != null ? String(opts.clientId) : null,
      detail: opts.detail != null ? String(opts.detail).slice(0, 500) : null,
      updated_at: opts.now,
    },
    { onConflict: "id" },
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

