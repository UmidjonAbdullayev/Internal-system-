import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Relay-Extension-Key",
};

const SECTION_OK = new Set(["IN_TRANSIT", "UPCOMING", "HISTORY"]);
const REMOVED_AFTER_MS = 10 * 60 * 1000;

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

function isValidRelayId(id: unknown): boolean {
  if (id == null) return false;
  const s = String(id).trim();
  if (!s || s.length < 6 || s.length > 40 || /\s/.test(s)) return false;
  return /^T-[A-Z0-9]{5,}$/i.test(s) || /^[0-9]{2,3}[A-Z0-9]{5,}$/i.test(s);
}

function normalizeSection(raw: unknown): string | null {
  const s = String(raw || "").toUpperCase().replace(/-/g, "_");
  if (s === "INTRANSIT") return "IN_TRANSIT";
  if (SECTION_OK.has(s)) return s;
  return null;
}

function sanitizeDriverName(raw: unknown): string | null {
  if (raw == null) return null;
  const firstLine = String(raw).split(/\n/)[0].replace(/\s+/g, " ").trim();
  if (!firstLine || firstLine.length < 3 || firstLine.length > 60) return null;
  if (/\d/.test(firstLine) || /,\s*[A-Z]{2}\b/.test(firstLine)) return null;
  return firstLine;
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

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json();
    const tripsIn = Array.isArray(body.trips) ? body.trips : [];
    const snapshot = body.snapshot && typeof body.snapshot === "object" ? body.snapshot : null;
    const now = new Date().toISOString();
    const errors: string[] = [];
    let tripsUpserted = 0;
    let legsUpserted = 0;
    let stopsUpserted = 0;
    let snapshotMoved = 0;
    let snapshotRemoved = 0;
    const syncedTripIds: string[] = [];
    const sectionCounts: Record<string, { relay: number; crm: number; mismatch: boolean }> = {};

    for (const trip of tripsIn) {
      const tripId = String(trip?.tripId || "").trim().toUpperCase();
      if (!tripId || !isValidRelayId(tripId)) {
        errors.push(`Invalid tripId skipped: ${trip?.tripId || "(missing)"}`);
        continue;
      }
      const section = normalizeSection(trip.tab || trip.section);
      const { error: tripErr } = await sb.from("relay_trips").upsert(
        {
          trip_id: tripId,
          section,
          relay_version: trip.version != null ? String(trip.version) : null,
          last_seen_at: now,
          tour_state: trip.tourState ?? null,
          execution_status: trip.executionStatus ?? null,
          work_type: trip.workType ?? null,
          business_type: trip.businessType ?? null,
          start_time: trip.startTime ?? null,
          end_time: trip.endTime ?? null,
          total_miles: trip.totalMiles ?? null,
          payout: trip.payout ?? null,
          currency: trip.currency ?? null,
          rate_per_mile: trip.ratePerMile ?? null,
          driver_name_raw: sanitizeDriverName(trip.driver),
          equipment: trip.equipment ?? null,
          status: trip.status || trip.executionStatus || trip.tourState || null,
          content_hash: trip.contentHash ?? null,
          raw: trip.raw ?? {},
          archived: false,
          updated_at: now,
        },
        { onConflict: "trip_id" },
      );
      if (tripErr) {
        errors.push(`Trip upsert ${tripId}: ${tripErr.message}`);
        continue;
      }
      tripsUpserted += 1;
      syncedTripIds.push(tripId);

      for (const leg of trip.legs || []) {
        const loadId = String(leg?.loadId || "").trim().toUpperCase();
        if (!loadId || !isValidRelayId(loadId)) continue;
        const { error: legErr } = await sb.from("relay_legs").upsert(
          {
            load_id: loadId,
            trip_id: tripId,
            facility_sequence: leg.facilitySequence ?? null,
            execution_status: leg.executionStatus ?? null,
            equipment_type: leg.equipmentType ?? null,
            miles: leg.miles ?? null,
            payout: leg.payout ?? null,
            tractor_id: leg.tractorId ?? null,
            trailer_id: leg.trailerId ?? null,
            driver_name_raw: sanitizeDriverName(leg.driver),
            cpt: leg.cpt ?? null,
            raw: {},
            archived: false,
            last_seen_at: now,
            updated_at: now,
          },
          { onConflict: "load_id" },
        );
        if (legErr) {
          errors.push(`Leg upsert ${loadId}: ${legErr.message}`);
          continue;
        }
        legsUpserted += 1;

        for (const stop of leg.stops || []) {
          const seq = stop.seq ?? 0;
          const stopId = `${tripId}:${loadId}:${seq}`;
          const { error: stopErr } = await sb.from("relay_stops").upsert(
            {
              stop_id: stopId,
              load_id: loadId,
              trip_id: tripId,
              seq,
              stop_type: stop.stopType ?? null,
              facility_code: stop.facilityCode ?? null,
              address: stop.address ?? null,
              city: stop.city ?? null,
              state: stop.state ?? null,
              zip: stop.zip ?? null,
              time_zone: stop.timeZone ?? null,
              scheduled_arrival: stop.scheduledArrival ?? null,
              actual_arrival: stop.actualArrival ?? null,
              scheduled_departure: stop.scheduledDeparture ?? null,
              actual_departure: stop.actualDeparture ?? null,
              eta: stop.eta ?? null,
              scheduled_arrival_local: stop.scheduledArrivalLocal ?? null,
              actual_arrival_local: stop.actualArrivalLocal ?? null,
              raw: {},
              archived: false,
              updated_at: now,
            },
            { onConflict: "stop_id" },
          );
          if (stopErr) errors.push(`Stop upsert ${stopId}: ${stopErr.message}`);
          else stopsUpserted += 1;
        }
      }
    }

    if (snapshot?.section && Array.isArray(snapshot.tripIds)) {
      const section = normalizeSection(snapshot.section);
      if (!section) {
        errors.push(`Invalid snapshot section: ${snapshot.section}`);
      } else {
        const tripIds = [
          ...new Set(
            snapshot.tripIds
              .map((id: unknown) => String(id || "").trim().toUpperCase())
              .filter((id: string) => isValidRelayId(id)),
          ),
        ];
        const totalRecords = Number(snapshot.totalRecords) || 0;
        const syncedAt = snapshot.syncedAt || now;
        const inSnapshot = new Set(tripIds);

        const { data: sectionRows } = await sb
          .from("relay_trips")
          .select("trip_id")
          .eq("section", section)
          .eq("archived", false);

        for (const row of sectionRows || []) {
          if (inSnapshot.has(row.trip_id)) continue;
          const { error } = await sb
            .from("relay_trips")
            .update({ status: "moved_awaiting_section", updated_at: now })
            .eq("trip_id", row.trip_id);
          if (error) errors.push(`Snapshot move ${row.trip_id}: ${error.message}`);
          else snapshotMoved += 1;
        }

        const cutoff = new Date(Date.now() - REMOVED_AFTER_MS).toISOString();
        const { data: stale } = await sb
          .from("relay_trips")
          .select("trip_id")
          .eq("archived", false)
          .eq("status", "moved_awaiting_section")
          .lt("last_seen_at", cutoff);

        for (const row of stale || []) {
          if (inSnapshot.has(row.trip_id)) continue;
          const { error } = await sb
            .from("relay_trips")
            .update({
              status: "removed_from_relay",
              section: "HISTORY",
              updated_at: now,
            })
            .eq("trip_id", row.trip_id);
          if (error) errors.push(`Snapshot remove ${row.trip_id}: ${error.message}`);
          else snapshotRemoved += 1;
        }

        const { count: crmCount } = await sb
          .from("relay_trips")
          .select("trip_id", { count: "exact", head: true })
          .eq("section", section)
          .eq("archived", false)
          .neq("status", "removed_from_relay");

        const crm = crmCount ?? 0;
        const mismatch = crm !== tripIds.length;
        await sb.from("relay_section_snapshots").upsert(
          {
            section,
            trip_ids: tripIds,
            total_records: totalRecords,
            crm_count: crm,
            mismatch,
            synced_at: syncedAt,
            updated_at: now,
          },
          { onConflict: "section" },
        );
        sectionCounts[section] = { relay: tripIds.length, crm, mismatch };
      }
    }

    return json({
      success: true,
      trips_upserted: tripsUpserted,
      legs_upserted: legsUpserted,
      stops_upserted: stopsUpserted,
      snapshot_moved: snapshotMoved,
      snapshot_removed: snapshotRemoved,
      synced_trip_ids: syncedTripIds,
      section_counts: sectionCounts,
      errors,
    });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});
