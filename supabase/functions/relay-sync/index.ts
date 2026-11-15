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
  tractor_id?: string | null;
  parent_trip_id?: string | null;
  trip_bucket?: string | null;
  status_bar_state?: string | null;
  status_stop_index?: number | null;
  job_type?: string | null;
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

/** Reject scrapes that used a schedule date as load_id (e.g. "Sep 29, 2026"). */
function isValidRelayLoadId(id: unknown): boolean {
  if (id == null) return false;
  const s = String(id).trim();
  if (!s || s.length < 6 || s.length > 40) return false;
  if (/\s/.test(s)) return false;
  if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)/i.test(s)) return false;
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(s)) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return false;
  if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(s)) return false;
  return /^T-[A-Z0-9]{5,}$/i.test(s) || /^[0-9]{2,3}[A-Z0-9]{5,}$/i.test(s);
}

function isCompleteLoad(load: LoadIn) {
  return Boolean(
    isValidRelayLoadId(load?.load_id) &&
      load?.load_status &&
      load?.pickup_location &&
      load?.delivery_location &&
      load?.pickup_date &&
      load?.delivery_date,
  );
}

/** True when scrape left a placeholder or numeric/money scrap instead of a place. */
function isBadPlace(raw: unknown): boolean {
  if (raw == null) return true;
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s || s.length < 3) return true;
  if (/^unknown\b/i.test(s)) return true;
  if (/^\$/.test(s) || /\$\s*[\d,]/.test(s)) return true;
  if (/^\d[\d,]*\.?\d*\s*(mi|miles)?\s*$/i.test(s)) return true;
  if (/^\/?Live$/i.test(s)) return true;
  if (/^[,.]/.test(s) || /^[a-z]/.test(s)) return true;
  return false;
}

function preferPlace(incoming: unknown, existing: unknown, fallback: string): string {
  const next = incoming == null ? "" : String(incoming).trim();
  const prev = existing == null ? "" : String(existing).trim();
  if (!isBadPlace(next)) return next.slice(0, 120);
  if (!isBadPlace(prev)) return prev.slice(0, 120);
  return fallback;
}

const TERMINAL_STATUSES = new Set(["Completed", "Delivered", "Cancelled", "Rejected"]);

/** Keep trip_bucket + load_status consistent so History never sticks as active. */
function normalizeLoadBucketStatus(load: LoadIn): LoadIn {
  let status = load.load_status;
  let bucket = load.trip_bucket ?? null;
  if (bucket === "history") {
    if (!status || status === "Booked" || status === "In Transit" || status === "Dispatched" || status === "Available") {
      status = "Completed";
    }
  }
  if (status && TERMINAL_STATUSES.has(status)) {
    bucket = "history";
  } else if (bucket === "history" && !status) {
    status = "Completed";
  }
  return { ...load, load_status: status, trip_bucket: bucket };
}

type DriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  notes: string | null;
  driver_id?: string | null;
};

function normName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match Relay display names ("U. Aminov", "Umed Aminov", "AMINOV UMED")
 * to CRM drivers (case-insensitive; initial+surname; swapped order; notes partners).
 */
function matchDriverId(rawName: string, drivers: DriverRow[]): string | null {
  const raw = String(rawName || "").trim().replace(/\s+/g, " ");
  if (!raw || !drivers.length) return null;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;

  const n = normName(raw);
  const tokens = n.split(" ").filter(Boolean);

  // Exact full-name forms: "umed aminov" / "aminov umed"
  for (const d of drivers) {
    const fn = normName(d.first_name || "");
    const ln = normName(d.last_name || "");
    if (!fn || !ln) continue;
    if (n === `${fn} ${ln}` || n === `${ln} ${fn}`) return d.id;
  }

  const looksInitial = (t: string) => /^[a-z]$/.test(t.replace(/\./g, ""));

  // "U. Aminov" / "U Aminov" → last=Aminov, first initial U
  if (parts.length >= 2) {
    const firstTok = normName(parts[0]);
    const lastTok = normName(parts[parts.length - 1]);
    const mid = parts.length > 2 ? normName(parts.slice(1, -1).join(" ")) : "";

    // Prefer surname = last token (Western Relay order)
    let candidates = drivers.filter((d) => normName(d.last_name || "") === lastTok);
    if (!candidates.length) {
      // Surname-first Relay rare: first token is surname
      candidates = drivers.filter((d) => normName(d.last_name || "") === firstTok);
    }
    // Also try first_name holding surname (bad seed) or notes
    if (!candidates.length) {
      candidates = drivers.filter((d) => {
        const hay = `${normName(d.first_name || "")} ${normName(d.last_name || "")} ${normName(d.notes || "")}`;
        return hay.includes(lastTok) || hay.includes(firstTok);
      });
    }

    if (looksInitial(firstTok) || /^[a-z]\.?$/.test(parts[0].toLowerCase())) {
      const initial = firstTok.charAt(0);
      const hit = candidates.find((d) => {
        const fn = normName(d.first_name || "");
        const ln = normName(d.last_name || "");
        // Umed Aminov: first starts with U, last Aminov
        if (ln === lastTok && fn.startsWith(initial)) return true;
        if (fn === lastTok && ln.startsWith(initial)) return true; // swapped storage
        // notes partner "Umed Aminov"
        const notes = normName(d.notes || "");
        if (notes.includes(lastTok) && new RegExp(`\\b${initial}[a-z]*\\b`).test(notes)) {
          return true;
        }
        return false;
      });
      if (hit) return hit.id;
    }

    // Full first + last
    const hitFull = candidates.find((d) => {
      const fn = normName(d.first_name || "");
      const ln = normName(d.last_name || "");
      if (ln === lastTok && (fn === firstTok || fn.startsWith(firstTok) || firstTok.startsWith(fn))) {
        return true;
      }
      if (fn === lastTok && (ln === firstTok || ln.startsWith(firstTok))) return true;
      if (mid && (fn.includes(mid) || normName(d.notes || "").includes(mid))) return true;
      return false;
    });
    if (hitFull) return hitFull.id;

    // Unique surname match
    if (candidates.length === 1) return candidates[0].id;
  }

  // Single token: unique first or last or notes
  if (tokens.length === 1) {
    const t = tokens[0];
    const byLast = drivers.filter((d) => normName(d.last_name || "") === t);
    if (byLast.length === 1) return byLast[0].id;
    const byFirst = drivers.filter((d) => normName(d.first_name || "") === t);
    if (byFirst.length === 1) return byFirst[0].id;
    const byNotes = drivers.filter((d) => normName(d.notes || "").includes(t));
    if (byNotes.length === 1) return byNotes[0].id;
  }

  // Fuzzy: all raw tokens appear across first/last/notes
  const scored = drivers
    .map((d) => {
      const hay = `${normName(d.first_name || "")} ${normName(d.last_name || "")} ${normName(d.notes || "")}`;
      const hits = tokens.filter((t) => t.length > 1 && hay.includes(t)).length;
      return { d, hits };
    })
    .filter((x) => x.hits >= Math.min(2, tokens.length))
    .sort((a, b) => b.hits - a.hits);
  if (scored.length && scored[0].hits > 0) {
    if (scored.length === 1 || scored[0].hits > scored[1].hits) return scored[0].d.id;
  }
  return null;
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
    /** When set (full Upcoming+In Transit pass), demote other active amazon_relay rows to History. */
    const reconcileActiveIds: string[] | null = Array.isArray(body.reconcile_active_ids)
      ? body.reconcile_active_ids.filter((id: unknown) => isValidRelayLoadId(id)).map(String)
      : null;
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
      driver_id?: string | null;
      trailer_id?: string | null;
      load_id?: string | null;
    }> = [];

    const { data: driverRows } = await sb
      .from("drivers")
      .select("id, first_name, last_name, notes, driver_id");
    const driversCache: DriverRow[] = (driverRows || []) as DriverRow[];

    for (const rawLoad of loads) {
      const load = normalizeLoadBucketStatus(rawLoad);
      if (!isValidRelayLoadId(load?.load_id)) {
        errors.push(
          `Invalid load_id skipped (expected T-… / leg id, not a date): ${load?.load_id || "(missing id)"}`,
        );
        continue;
      }
      if (!isCompleteLoad(load)) {
        errors.push(`Incomplete load skipped: ${load?.load_id || "(missing id)"}`);
        continue;
      }

      const { data: existing, error: findErr } = await sb
        .from("loads")
        .select(
          "id, load_id, load_status, payment_status, content_hash, status_history, trailer_id, tractor_id, driver_id, status_bar_state, status_stop_index, trip_bucket, parent_trip_id, driver_name_raw, pickup_location, delivery_location, rate_gross",
        )
        .eq("load_id", load.load_id)
        .maybeSingle();
      if (findErr) {
        errors.push(`Lookup failed ${load.load_id}: ${findErr.message}`);
        continue;
      }

      const driverId = load.driver_name_raw
        ? matchDriverId(String(load.driver_name_raw), driversCache)
        : null;

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
            driver_id: driverId || existing.driver_id,
            trailer_id: load.trailer_id ?? existing.trailer_id,
            load_id: load.load_id,
          });
        }
      }

      if (
        existing &&
        load.trailer_id &&
        existing.trailer_id &&
        load.trailer_id !== existing.trailer_id
      ) {
        notifications.push({
          event_type: "trailer_change",
          dedupe_key: `trailer:${load.load_id}:${load.trailer_id}`,
          message: `Load ${load.load_id} trailer: ${existing.trailer_id} → ${load.trailer_id}`,
          driver_id: driverId || existing.driver_id,
          trailer_id: load.trailer_id,
          load_id: load.load_id,
        });
      }

      const nextBar = load.status_bar_state || null;
      const prevBar = existing?.status_bar_state || null;
      if (nextBar && nextBar !== prevBar) {
        const stop = load.status_stop_index ?? existing?.status_stop_index ?? 1;
        const trip = load.parent_trip_id || existing?.parent_trip_id || load.load_id;
        const driverLabel = load.driver_name_raw || existing?.driver_name_raw || "driver";
        if (nextBar === "arrived") {
          notifications.push({
            event_type: "facility_arrived",
            dedupe_key: `arrived:${load.load_id}:stop:${stop}`,
            message:
              `Arrived facility (stop ${stop})\n` +
              `Trip ${trip} · Load ${load.load_id}\n` +
              `Driver: ${driverLabel}\n` +
              `${load.pickup_location || existing?.pickup_location || "?"} → ${load.delivery_location || existing?.delivery_location || "?"}\n` +
              `Pay: $${load.rate_gross ?? existing?.rate_gross ?? 0}`,
            driver_id: driverId || existing?.driver_id,
            trailer_id: load.trailer_id ?? existing?.trailer_id,
            load_id: load.load_id,
          });
        } else if (nextBar === "loaded_enroute") {
          notifications.push({
            event_type: "loaded_enroute",
            dedupe_key: `enroute:${load.load_id}:stop:${stop}`,
            message:
              `Loaded & on the way (stop ${stop})\n` +
              `Trip ${trip} · Load ${load.load_id}\n` +
              `Driver: ${driverLabel}\n` +
              `${load.pickup_location || existing?.pickup_location || "?"} → ${load.delivery_location || existing?.delivery_location || "?"}`,
            driver_id: driverId || existing?.driver_id,
            trailer_id: load.trailer_id ?? existing?.trailer_id,
            load_id: load.load_id,
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
        // Never clobber a real city/state with Unknown / $ scraps from a collapsed scrape
        pickup_location: preferPlace(
          load.pickup_location,
          existing?.pickup_location,
          "Unknown origin",
        ),
        delivery_location: preferPlace(
          load.delivery_location,
          existing?.delivery_location,
          "Unknown destination",
        ),
        pickup_date: load.pickup_date,
        delivery_date: load.delivery_date,
        trailer_id: load.trailer_id ?? null,
        trailer_type: load.trailer_type ?? null,
        tractor_id: load.tractor_id ?? null,
        parent_trip_id: load.parent_trip_id ?? null,
        trip_bucket: load.trip_bucket ?? null,
        status_bar_state: load.status_bar_state ?? null,
        status_stop_index: load.status_stop_index ?? null,
        job_type: load.job_type ?? null,
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
        // UPSERT on load_id so concurrent tab scans never hit loads_load_id_key
        const { error } = await sb.from("loads").upsert(row, {
          onConflict: "load_id",
          ignoreDuplicates: false,
        });
        if (error) {
          errors.push(`Upsert ${load.load_id}: ${error.message}`);
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
          .eq("load_id", load.load_id);
        if (error) errors.push(`Touch ${load.load_id}: ${error.message}`);
        else {
          syncedLoadIds.push(load.load_id);
          loadsUpdated += 1;
        }
      } else {
        const { error } = await sb
          .from("loads")
          .upsert(
            { ...row, last_changed: now },
            { onConflict: "load_id", ignoreDuplicates: false },
          );
        if (error) {
          errors.push(`Upsert ${load.load_id}: ${error.message}`);
          continue;
        }
        loadsUpdated += 1;
        syncedLoadIds.push(load.load_id);
        if (existing.payment_status !== row.payment_status) {
          notifications.push({
            event_type: "payment_change",
            dedupe_key: `pay_status:${load.load_id}:${row.payment_status}`,
            message: `Load ${load.load_id} payment: ${existing.payment_status} → ${row.payment_status}`,
            driver_id: driverId || existing.driver_id,
            trailer_id: row.trailer_id,
            load_id: load.load_id,
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

    // Full active pass: anything still upcoming/in_transit but not in Relay's active set → History
    let loadsReconciled = 0;
    if (reconcileActiveIds) {
      const activeSet = new Set(reconcileActiveIds.map((id) => id.toUpperCase()));
      const { data: activeRows, error: activeErr } = await sb
        .from("loads")
        .select("id, load_id, load_status, trip_bucket, status_history")
        .eq("source", "amazon_relay")
        .in("trip_bucket", ["upcoming", "in_transit"]);
      if (activeErr) {
        errors.push(`Active reconcile lookup: ${activeErr.message}`);
      } else {
        for (const row of activeRows || []) {
          const lid = String(row.load_id || "").toUpperCase();
          if (!lid || activeSet.has(lid)) continue;
          if (TERMINAL_STATUSES.has(String(row.load_status))) {
            const { error } = await sb
              .from("loads")
              .update({
                trip_bucket: "history",
                last_changed: now,
                last_synchronized: now,
                updated_at: now,
              })
              .eq("id", row.id);
            if (!error) loadsReconciled += 1;
            continue;
          }
          const nextStatus = "Completed";
          const prevHistory = Array.isArray(row.status_history) ? row.status_history : [];
          const { error } = await sb
            .from("loads")
            .update({
              trip_bucket: "history",
              load_status: nextStatus,
              last_changed: now,
              last_synchronized: now,
              last_observed: now,
              updated_at: now,
              status_history: [
                ...prevHistory,
                {
                  status: nextStatus,
                  timestamp: now,
                  note: "Reconciled off Relay active set (Upcoming/In Transit)",
                },
              ],
            })
            .eq("id", row.id);
          if (error) errors.push(`Reconcile ${row.load_id}: ${error.message}`);
          else {
            loadsReconciled += 1;
            notifications.push({
              event_type: "load_status_change",
              dedupe_key: `reconcile_history:${row.load_id}:${nextStatus}`,
              message: `Load ${row.load_id} moved to History (no longer on Relay active trips)`,
              load_id: row.load_id,
            });
          }
        }
      }

      // Also fix any terminal-status rows still tagged upcoming/in_transit
      await sb
        .from("loads")
        .update({ trip_bucket: "history", updated_at: now, last_synchronized: now })
        .eq("source", "amazon_relay")
        .in("trip_bucket", ["upcoming", "in_transit"])
        .in("load_status", ["Completed", "Delivered", "Cancelled", "Rejected"]);
    }

    await sb
      .from("relay_sync_runs")
      .update({
        finished_at: now,
        status: errors.length ? "completed_with_errors" : "completed",
        records_collected: loads.length + payments.length,
        records_updated: loadsUpdated + paymentsUpserted + loadsPaymentUpdated + loadsReconciled,
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
      loads_reconciled: loadsReconciled,
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
