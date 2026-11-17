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
  let tripsUpserted = 0;
  let legsUpserted = 0;
  let stopsUpserted = 0;
  const syncedTripIds: string[] = [];

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
    // Cancelled never stays on UPCOMING / IN_TRANSIT regardless of request tab.
    if (cancelled) {
      section = "HISTORY";
      if (!status || !/cancel/i.test(String(status))) {
        // keep Relay status if already cancelled-shaped; else force Cancelled label source
      }
    }

    const { data: prevTrip } = await sb
      .from("relay_trips")
      .select("trip_id, section, status")
      .eq("trip_id", tripId)
      .maybeSingle();

    const nextStatus = cancelled
      ? String(status || "CANCELLED")
      : status;

    const { error: tripErr } = await sb.from("relay_trips").upsert(
      {
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
        caught_up_at: opts.catchUp ? now : undefined,
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

    if (prevTrip && prevTrip.section !== section) {
      await recordTripEvent(sb, {
        trip_id: tripId,
        event_type: cancelled ? "cancelled_to_history" : "section_change",
        from_section: prevTrip.section,
        to_section: section,
        from_status: prevTrip.status,
        to_status: nextStatus != null ? String(nextStatus) : null,
        detail: { source_tab: sourceTab },
      });
    } else if (!prevTrip && cancelled && section === "HISTORY") {
      await recordTripEvent(sb, {
        trip_id: tripId,
        event_type: "cancelled_to_history",
        from_section: sourceTab,
        to_section: "HISTORY",
        to_status: nextStatus != null ? String(nextStatus) : null,
        detail: { source_tab: sourceTab, first_seen: true },
      });
    }

    if (opts.catchUp) {
      await sb
        .from("relay_trips")
        .update({
          section: "HISTORY",
          caught_up_at: now,
          updated_at: now,
        })
        .eq("trip_id", tripId);
    }

    for (const leg of (trip.legs as Record<string, unknown>[]) || []) {
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

      for (const stop of (leg.stops as Record<string, unknown>[]) || []) {
        const seq = (stop.seq as number) ?? 0;
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

  return { tripsUpserted, legsUpserted, stopsUpserted, syncedTripIds, errors };
}

