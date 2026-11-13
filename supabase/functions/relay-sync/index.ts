import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Relay-Extension-Key",
};

type LoadIn = {
  load_id: string;
  amazon_ref_id?: string | null;
  load_status: string;
  payment_status?: string | null;
  pickup_location: string;
  delivery_location: string;
  pickup_date: string;
  delivery_date: string;
  trailer_id?: string | null;
  trailer_type?: string | null;
  distance_miles?: number | null;
  rate_gross?: number | null;
  additional_charges?: number | null;
  payment_date?: string | null;
  driver_name_raw?: string | null;
  notes?: string | null;
  content_hash?: string | null;
  section?: string | null;
};

type PaymentIn = {
  reference_id?: string | null;
  amazon_ref_id?: string | null;
  load_id?: string | null;
  amount?: number | null;
  payment_date?: string | null;
  method?: string | null;
  payment_status?: string | null;
  notes?: string | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireExtensionKey(req: Request): string | Response {
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

function isCompleteLoad(load: LoadIn) {
  return Boolean(
    load?.load_id &&
      load?.load_status &&
      load?.pickup_location &&
      load?.delivery_location &&
      load?.pickup_date &&
      load?.delivery_date,
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  const auth = requireExtensionKey(req);
  if (auth instanceof Response) return auth;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const body = await req.json();
    const loads: LoadIn[] = Array.isArray(body.loads) ? body.loads : [];
    const payments: PaymentIn[] = Array.isArray(body.payments) ? body.payments : [];
    const clientId = typeof body.client_id === "string" ? body.client_id : null;
    const now = new Date().toISOString();

    const { data: run, error: runErr } = await sb
      .from("relay_sync_runs")
      .insert({
        status: "running",
        client_id: clientId,
        section_states: body.section_states || {},
      })
      .select("id")
      .single();
    if (runErr) return json({ success: false, error: runErr.message }, 500);

    let loadsInserted = 0;
    let loadsUpdated = 0;
    let loadsPaymentUpdated = 0;
    let paymentsUpserted = 0;
    const errors: string[] = [];
    const syncedLoadIds: string[] = [];
    const syncedPaymentRefs: string[] = [];
    const notifications: Array<{
      event_type: string;
      dedupe_key: string;
      message: string;
    }> = [];

    for (const load of loads) {
      if (!isCompleteLoad(load)) {
        errors.push(`Incomplete load skipped: ${load?.load_id || "(missing id)"}`);
        continue;
      }

      const { data: existing, error: findErr } = await sb
        .from("loads")
        .select("id, load_id, load_status, payment_status, content_hash, status_history")
        .eq("load_id", load.load_id)
        .maybeSingle();
      if (findErr) {
        errors.push(`Lookup failed ${load.load_id}: ${findErr.message}`);
        continue;
      }

      let driverId: string | null = null;
      if (load.driver_name_raw) {
        const parts = String(load.driver_name_raw).trim().split(/\s+/);
        if (parts.length >= 2) {
          const { data: driver } = await sb
            .from("drivers")
            .select("id")
            .ilike("first_name", parts[0])
            .ilike("last_name", parts.slice(1).join(" "))
            .maybeSingle();
          driverId = driver?.id ?? null;
        }
      }

      const statusHistory = Array.isArray(existing?.status_history)
        ? [...existing.status_history]
        : [];
      if (!existing || existing.load_status !== load.load_status) {
        statusHistory.push({
          status: load.load_status,
          timestamp: now,
          note: "Observed from Amazon Relay page",
        });
        if (existing && existing.load_status !== load.load_status) {
          notifications.push({
            event_type: "load_status_change",
            dedupe_key: `load_status:${load.load_id}:${load.load_status}`,
            message: `Load ${load.load_id} status: ${existing.load_status} → ${load.load_status}`,
          });
        }
      }

      const row = {
        load_id: load.load_id,
        amazon_ref_id: load.amazon_ref_id ?? null,
        driver_id: driverId,
        driver_name_raw: load.driver_name_raw ?? null,
        load_status: load.load_status,
        payment_status: load.payment_status || existing?.payment_status || "Not Received",
        pickup_location: load.pickup_location,
        delivery_location: load.delivery_location,
        pickup_date: load.pickup_date,
        delivery_date: load.delivery_date,
        trailer_id: load.trailer_id ?? null,
        trailer_type: load.trailer_type ?? null,
        distance_miles: load.distance_miles ?? 0,
        rate_gross: load.rate_gross ?? 0,
        additional_charges: load.additional_charges ?? 0,
        payment_date: load.payment_date ?? null,
        notes: load.notes ?? null,
        status_history: statusHistory,
        last_observed: now,
        last_synchronized: now,
        content_hash: load.content_hash ?? null,
        source: "amazon_relay",
        is_stale: false,
        updated_at: now,
      };

      if (!existing) {
        const { error } = await sb.from("loads").insert(row);
        if (error) {
          errors.push(`Insert ${load.load_id}: ${error.message}`);
          continue;
        }
        loadsInserted += 1;
        syncedLoadIds.push(load.load_id);
        await sb.from("activity_logs").insert({
          type: "load",
          action: "created",
          description: `Amazon Relay load ${load.load_id} synced`,
          entity_id: load.load_id,
          user_name: "Relay Extension",
        });
      } else if (existing.content_hash && load.content_hash && existing.content_hash === load.content_hash) {
        const { error } = await sb
          .from("loads")
          .update({ last_observed: now, last_synchronized: now, is_stale: false })
          .eq("id", existing.id);
        if (error) errors.push(`Touch ${load.load_id}: ${error.message}`);
        else {
          syncedLoadIds.push(load.load_id);
          loadsUpdated += 1;
        }
      } else {
        const { error } = await sb
          .from("loads")
          .update({ ...row, last_changed: now })
          .eq("id", existing.id);
        if (error) {
          errors.push(`Update ${load.load_id}: ${error.message}`);
          continue;
        }
        loadsUpdated += 1;
        syncedLoadIds.push(load.load_id);
        if (existing.payment_status !== row.payment_status) {
          notifications.push({
            event_type: "payment_change",
            dedupe_key: `pay_status:${load.load_id}:${row.payment_status}`,
            message: `Load ${load.load_id} payment: ${existing.payment_status} → ${row.payment_status}`,
          });
        }
      }
    }

    for (const payment of payments) {
      const ref = payment.reference_id || payment.amazon_ref_id || payment.load_id;
      if (!ref) {
        errors.push("Payment missing reference");
        continue;
      }

      if (payment.load_id && payment.payment_status) {
        const { data: loadRow } = await sb
          .from("loads")
          .select("id, payment_status")
          .eq("load_id", payment.load_id)
          .maybeSingle();
        if (loadRow && loadRow.payment_status !== payment.payment_status) {
          await sb
            .from("loads")
            .update({
              payment_status: payment.payment_status,
              payment_date: payment.payment_date ?? null,
              last_observed: now,
              last_changed: now,
              last_synchronized: now,
            })
            .eq("id", loadRow.id);
          loadsPaymentUpdated += 1;
          notifications.push({
            event_type: "payment_change",
            dedupe_key: `pay_status:${payment.load_id}:${payment.payment_status}`,
            message: `Load ${payment.load_id} payment: ${loadRow.payment_status} → ${payment.payment_status}`,
          });
        }
      }

      if (payment.amount == null || !payment.payment_date) {
        // Status-only updates are valid; skip payment row insert when incomplete
        if (payment.payment_status) syncedPaymentRefs.push(ref);
        continue;
      }

      const { data: existingPay } = await sb
        .from("payments")
        .select("id, amount, payment_date, content_hash")
        .eq("reference_id", ref)
        .maybeSingle();

      const payRow = {
        settlement_id: null,
        load_id: null as string | null,
        payment_date: payment.payment_date,
        method: payment.method || "Amazon Relay",
        reference_id: ref,
        amount: payment.amount,
        notes: payment.notes ?? null,
        amazon_ref_id: payment.amazon_ref_id ?? payment.load_id ?? null,
        last_observed: now,
        last_synchronized: now,
        content_hash: `${ref}|${payment.amount}|${payment.payment_date}`,
        source: "amazon_relay",
      };

      if (payment.load_id) {
        const { data: loadRow } = await sb
          .from("loads")
          .select("id")
          .eq("load_id", payment.load_id)
          .maybeSingle();
        payRow.load_id = loadRow?.id ?? null;
      }

      if (!existingPay) {
        const { error } = await sb.from("payments").insert(payRow);
        if (error) errors.push(`Payment insert ${ref}: ${error.message}`);
        else {
          paymentsUpserted += 1;
          syncedPaymentRefs.push(ref);
          notifications.push({
            event_type: "payment_change",
            dedupe_key: `pay_new:${ref}`,
            message: `New Relay payment ${ref}: $${payment.amount}`,
          });
        }
      } else if (existingPay.content_hash !== payRow.content_hash) {
        const { error } = await sb
          .from("payments")
          .update({ ...payRow, last_changed: now })
          .eq("id", existingPay.id);
        if (error) errors.push(`Payment update ${ref}: ${error.message}`);
        else {
          paymentsUpserted += 1;
          syncedPaymentRefs.push(ref);
          notifications.push({
            event_type: "payment_change",
            dedupe_key: `pay_upd:${ref}:${payRow.content_hash}`,
            message: `Relay payment updated ${ref}: $${payment.amount}`,
          });
        }
      } else {
        await sb
          .from("payments")
          .update({ last_observed: now, last_synchronized: now })
          .eq("id", existingPay.id);
        syncedPaymentRefs.push(ref);
      }
    }

    // Mark loads not observed recently as stale (36h)
    const staleBefore = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    await sb
      .from("loads")
      .update({ is_stale: true })
      .lt("last_observed", staleBefore)
      .eq("source", "amazon_relay")
      .eq("is_stale", false);

    await sb
      .from("relay_sync_runs")
      .update({
        finished_at: now,
        status: errors.length ? "completed_with_errors" : "completed",
        records_collected: loads.length + payments.length,
        records_updated: loadsUpdated + paymentsUpserted + loadsPaymentUpdated,
        records_inserted: loadsInserted,
        error_count: errors.length,
        errors,
        section_states: body.section_states || {},
      })
      .eq("id", run.id);

    return json({
      success: true,
      run_id: run.id,
      loads_inserted: loadsInserted,
      loads_updated: loadsUpdated,
      loads_payment_updated: loadsPaymentUpdated,
      payments_upserted: paymentsUpserted,
      synced_load_ids: syncedLoadIds,
      synced_payment_refs: syncedPaymentRefs,
      errors,
      notifications,
    });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});
