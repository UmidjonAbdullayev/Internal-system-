/**
 * One-time / operator remap: rebuild relay_stops times from relay_trips.raw
 * actions[] CHECKIN/CHECKOUT. No Telegram / trip-alerts side effects.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

function toIso(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    if (!/^-?\d+(\.\d+)?$/.test(s)) {
      const ms = Date.parse(s);
      if (!Number.isFinite(ms) || ms <= 0) return null;
      return new Date(ms).toISOString();
    }
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms).toISOString();
}

function findAction(
  actions: unknown,
  type: string,
): Record<string, unknown> | null {
  if (!Array.isArray(actions)) return null;
  const upper = type.toUpperCase();
  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    const row = a as Record<string, unknown>;
    if (String(row.type || "").toUpperCase() === upper) return row;
  }
  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    const row = a as Record<string, unknown>;
    if (String(row.actionType || "").toUpperCase() === upper) return row;
  }
  return null;
}

function delayReason(action: Record<string, unknown> | null): string | null {
  if (!action) return null;
  const report = action.delayReport as Record<string, unknown> | null | undefined;
  if (!report || typeof report !== "object") return null;
  const v = report.delayReason ?? report.reason;
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export async function remapStopsFromTripRaw(
  sb: SupabaseClient,
  opts: { sections?: string[] | null } = {},
): Promise<{
  tripsScanned: number;
  stopsUpdated: number;
  stopsWithTimes: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const sections = (opts.sections || ["UPCOMING", "IN_TRANSIT", "HISTORY"]).map((s) =>
    String(s).toUpperCase(),
  );
  const now = new Date().toISOString();
  let tripsScanned = 0;
  let stopsUpdated = 0;
  let stopsWithTimes = 0;
  const pageSize = 100;
  let from = 0;

  for (;;) {
    let q = sb
      .from("relay_trips")
      .select("trip_id, section, raw, start_time, end_time")
      .eq("archived", false)
      .in("section", sections)
      .order("trip_id", { ascending: true })
      .range(from, from + pageSize - 1);
    const { data: trips, error } = await q;
    if (error) {
      errors.push(`Trip page ${from}: ${error.message}`);
      break;
    }
    if (!trips?.length) break;

    const stopRows: Record<string, unknown>[] = [];
    const tripTimeRows: { trip_id: string; start_time: string | null; end_time: string | null }[] =
      [];

    for (const trip of trips) {
      tripsScanned += 1;
      const tripId = String(trip.trip_id || "").toUpperCase();
      const raw = (trip.raw || {}) as Record<string, unknown>;
      const startIso = toIso(raw.startTime);
      const endIso = toIso(raw.endTime);
      if (startIso || endIso) {
        tripTimeRows.push({
          trip_id: tripId,
          start_time: startIso,
          end_time: endIso,
        });
      }

      const loads = Array.isArray(raw.loads) ? raw.loads : [];
      for (const load of loads) {
        if (!load || typeof load !== "object") continue;
        const loadObj = load as Record<string, unknown>;
        const versioned = loadObj.versionedLoadId as Record<string, unknown> | undefined;
        const loadId = String(versioned?.id || "").trim().toUpperCase();
        if (!loadId) continue;
        const stops = Array.isArray(loadObj.stops) ? loadObj.stops : [];
        for (const stop of stops) {
          if (!stop || typeof stop !== "object") continue;
          const stopObj = stop as Record<string, unknown>;
          const seq = Number(stopObj.stopSequenceNumber ?? 0);
          const stopId = `${tripId}:${loadId}:${seq}`;
          const loc = (stopObj.location || {}) as Record<string, unknown>;
          const checkin = findAction(stopObj.actions, "CHECKIN");
          const checkout = findAction(stopObj.actions, "CHECKOUT");
          const schArr = toIso(checkin?.plannedTime);
          const actArr = toIso(checkin?.actualTime);
          const schDep = toIso(checkout?.plannedTime);
          const actDep = toIso(checkout?.actualTime);
          const eta = toIso(stopObj.calculatedEstimateArrivalTime);
          const late = delayReason(checkin) || delayReason(checkout);
          if (schArr || actArr || schDep || actDep || eta) stopsWithTimes += 1;
          stopRows.push({
            stop_id: stopId,
            load_id: loadId,
            trip_id: tripId,
            seq,
            stop_type: stopObj.stopType ?? null,
            facility_code:
              stopObj.locationCode ?? loc.locationCode ?? loc.label ?? null,
            address: loc.line1 ?? null,
            city: loc.city ?? null,
            state: loc.state ?? null,
            zip: loc.postalCode ?? null,
            time_zone: loc.timeZone ?? stopObj.timeZone ?? null,
            scheduled_arrival: schArr,
            actual_arrival: actArr,
            scheduled_departure: schDep,
            actual_departure: actDep,
            eta,
            late_reason: late,
            arrival_time_source: checkin?.actualTimeSource
              ? String(checkin.actualTimeSource)
              : null,
            departure_time_source: checkout?.actualTimeSource
              ? String(checkout.actualTimeSource)
              : null,
            archived: false,
            updated_at: now,
          });
        }
      }
    }

    // Upsert in chunks — ignore version; no alerts.
    for (let i = 0; i < stopRows.length; i += 200) {
      const chunk = stopRows.slice(i, i + 200);
      const { error: stopErr } = await sb.from("relay_stops").upsert(chunk, {
        onConflict: "stop_id",
      });
      if (stopErr) errors.push(`Stop upsert ${from}+${i}: ${stopErr.message}`);
      else stopsUpdated += chunk.length;
    }

    for (const row of tripTimeRows) {
      const { error: tripErr } = await sb
        .from("relay_trips")
        .update({
          start_time: row.start_time,
          end_time: row.end_time,
          updated_at: now,
        })
        .eq("trip_id", row.trip_id);
      if (tripErr) errors.push(`Trip time ${row.trip_id}: ${tripErr.message}`);
    }

    if (trips.length < pageSize) break;
    from += pageSize;
  }

  return { tripsScanned, stopsUpdated, stopsWithTimes, errors };
}
