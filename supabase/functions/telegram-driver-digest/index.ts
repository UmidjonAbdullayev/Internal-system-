import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Status digests to driver groups are disabled.
 * Groups only receive facility-arrival alerts (see relay-telegram / relay-sync).
 * On-demand status is available in private bot DM after admin password + DRV gate.
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

  const expected = Deno.env.get("RELAY_EXTENSION_API_KEY");
  const provided = req.headers.get("X-Relay-Extension-Key") || "";
  if (!expected || provided !== expected) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  return json({
    success: true,
    skipped: true,
    reason: "facility_arrival_only",
    message:
      "Per-group digests disabled. Groups only get facility-arrival alerts; use bot DM menus for on-demand status.",
  });
});
