import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * DISABLED (Telegram rebuild IS-55).
 * All driver alerts go through trip-alerts → sendTelegram() only.
 * No automatic system / facility / ops messages from this function.
 * Existing bot @inter_sysbot unchanged; kill switch stays OFF until user enables.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Relay-Extension-Key",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }
  return json({
    success: true,
    skipped: true,
    reason: "relay_telegram_disabled_use_trip_alerts",
    note: "ARRIVED + NOT AT STOP only via trip-alerts/sendTelegram. TELEGRAM_ALERTS_ENABLED stays OFF until approved.",
  });
});
