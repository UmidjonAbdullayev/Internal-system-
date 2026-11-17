import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/** Manual / test trigger for daily HISTORY retention (pg_cron also runs 03:00). */

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
  const cronSecret = Deno.env.get("RETENTION_CRON_SECRET");
  const url = new URL(req.url);
  const cronOk = cronSecret && url.searchParams.get("cron_secret") === cronSecret;
  if (!cronOk && (!expected || provided !== expected)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const { data, error } = await sb.rpc("run_relay_retention");
    if (error) return json({ success: false, error: error.message }, 500);
    const { data: run } = await sb
      .from("cleanup_runs")
      .select("*")
      .eq("id", data)
      .maybeSingle();
    return json({ success: true, run_id: data, run });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});
