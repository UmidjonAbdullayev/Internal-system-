import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  isValidRelayId,
  looksCancelled,
  normalizeSection,
  recordTripEvent,
  sanitizeDriverName,
} from "./shared.ts";

function allLegsCancelled(trip: Record<string, unknown>): boolean {
  const legs = (trip.legs as Record<string, unknown>[]) || [];
  if (!legs.length) return false;
  return legs.every((leg) => {
    const st = String(leg.executionStatus || leg.status || "").toLowerCase();
    return /cancel/.test(st);
  });
}

type TripRow = Record<string, unknown>;
type LegRow = Record<string, unknown>;
type StopRow = Record<string, unknown>;

/**
 * Bulk-upsert trips + nested legs/stops (no per-row await loops).
 * Stop time field names match the extension payload — do not remap here
 * (IS-42 owns stop.actions → scheduled/actual mapping).
 */
export async function upsertTrips(
  sb: SupabaseClient,
  tripsIn: unknown[],
  now: string,
  opts: { catchUp: boolean; forceHistory: boolean },
): Promise<{
  tripsUpserted: number;
  legsUpserted: number;
  stopsUpserted: number;
  syncedTripIds: string[];
  errors: string[];
}> {
  const errors: string[] = [];
  const tripRows: TripRow[] = [];
  const legRows: LegRow[] = [];
  const stopRows: StopRow[] = [];
  const syncedTripIds: string[] = [];
  const prepared: Array<{
    tripId: string;
    section: string;
    sourceTab: string | null;
    nextStatus: unknown;
    cancelled: boolean;
  }> = [];

  for (const trip of tripsIn as Record<string, unknown>[]) {
    const tripId = String(trip?.tripId || "").trim().toUpperCase();
    if (!tripId || !isValidRelayId(tripId)) {
      errors.push(`Invalid tripId skipped: ${trip?.tripId || "(missing)"}`);
      continue;
    }
    const sourceTab = normalizeSection(trip.tab || trip.section);
    let section = sourceTab;
    if (opts.forceHistory || opts.catchUp) section = "HISTORY";

    const status = trip.status || trip.executionStatus || trip.tourState || null;
    const cancelled =
      looksCancelled(status, trip.tourState, trip.executionStatus) || allLegsCancelled(trip);
    if (cancelled) section = "HISTORY";
    if (!section) {
      errors.push(`Invalid section for trip ${tripId}`);
      continue;
    }

    const nextStatus = cancelled ? String(status || "CANCELLED") : status;

    tripRows.push({
      trip_id: tripId,
      section,
      source_tab: sourceTab,
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
      status: nextStatus,
      content_hash: trip.contentHash ?? null,
      raw: trip.raw ?? {},
      archived: false,
      ...(opts.catchUp ? { caught_up_at: now } : {}),
      updated_at: now,
    });

    prepared.push({ tripId, section, sourceTab, nextStatus, cancelled });
    syncedTripIds.push(tripId);

    for (const leg of (trip.legs as Record<string, unknown>[]) || []) {
      const loadId = String(leg?.loadId || "").trim().toUpperCase();
      if (!loadId || !isValidRelayId(loadId)) continue;
      legRows.push({
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
      });

      for (const stop of (leg.stops as Record<string, unknown>[]) || []) {
        const seq = (stop.seq as number) ?? 0;
        const stopId = `${tripId}:${loadId}:${seq}`;
        stopRows.push({
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
        });
      }
    }
  }

  if (!tripRows.length) {
    return {
      tripsUpserted: 0,
      legsUpserted: 0,
      stopsUpserted: 0,
      syncedTripIds: [],
      errors,
    };
  }

  // One SELECT for section-change events (not per trip).
  const { data: prevTrips, error: prevErr } = await sb
    .from("relay_trips")
    .select("trip_id, section, status")
    .in("trip_id", syncedTripIds);
  if (prevErr) errors.push(`Prev trip select: ${prevErr.message}`);
  const prevMap = new Map(
    (prevTrips || []).map((r: { trip_id: string; section: string; status: string | null }) => [
      r.trip_id,
      r,
    ]),
  );

  const { error: tripErr } = await sb.from("relay_trips").upsert(tripRows, {
    onConflict: "trip_id",
  });
  if (tripErr) {
    errors.push(`Trip bulk upsert: ${tripErr.message}`);
    return {
      tripsUpserted: 0,
      legsUpserted: 0,
      stopsUpserted: 0,
      syncedTripIds: [],
      errors,
    };
  }

  if (legRows.length) {
    const { error: legErr } = await sb.from("relay_legs").upsert(legRows, {
      onConflict: "load_id",
    });
    if (legErr) errors.push(`Leg bulk upsert: ${legErr.message}`);
  }

  if (stopRows.length) {
    const { error: stopErr } = await sb.from("relay_stops").upsert(stopRows, {
      onConflict: "stop_id",
    });
    if (stopErr) errors.push(`Stop bulk upsert: ${stopErr.message}`);
  }

  // Section-change / cancelled events (best-effort; parallel but not N×await in a loop body).
  await Promise.all(
    prepared.map(async (p) => {
      const prev = prevMap.get(p.tripId);
      if (prev && prev.section !== p.section) {
        await recordTripEvent(sb, {
          trip_id: p.tripId,
          event_type: p.cancelled ? "cancelled_to_history" : "section_change",
          from_section: prev.section,
          to_section: p.section,
          from_status: prev.status,
          to_status: p.nextStatus != null ? String(p.nextStatus) : null,
          detail: { source_tab: p.sourceTab },
        });
      } else if (!prev && p.cancelled && p.section === "HISTORY") {
        await recordTripEvent(sb, {
          trip_id: p.tripId,
          event_type: "cancelled_to_history",
          from_section: p.sourceTab,
          to_section: "HISTORY",
          to_status: p.nextStatus != null ? String(p.nextStatus) : null,
          detail: { source_tab: p.sourceTab, first_seen: true },
        });
      }
    }),
  );

  return {
    tripsUpserted: tripRows.length,
    legsUpserted: legRows.length,
    stopsUpserted: stopRows.length,
    syncedTripIds,
    errors,
  };
}
