/**
 * Map entitiesV2-normalized trips → CRM loads (compat) + trips payload (new model).
 */

import { mapLoadStatus, parseDate, isValidRelayLoadId, sanitizeDriverName } from './normalize.js';
import { tripContentHashPayload, hashString } from './extract.js';

/**
 * Edge `trips[]` shape: trip UPSERT + nested legs/stops (never save legs as trips).
 */
export async function tripsToEdgePayload(trips) {
  const out = [];
  for (const trip of trips || []) {
    if (!trip?.tripId) continue;
    const contentHash = await hashString(tripContentHashPayload(trip));
    const tab = String(trip.tab || '').toUpperCase();
    out.push({
      tripId: String(trip.tripId).toUpperCase(),
      version: trip.version ?? null,
      tab: tab || null,
      section: trip.section || null,
      tourState: trip.tourState || null,
      executionStatus: trip.executionStatus || null,
      workType: trip.workType || null,
      businessType: trip.businessType || null,
      startTime: trip.startTime || null,
      endTime: trip.endTime || null,
      totalMiles: trip.totalMiles ?? null,
      payout: trip.payout ?? null,
      currency: trip.currency || null,
      ratePerMile: trip.ratePerMile ?? null,
      driver: trip.driver || null,
      equipment: trip.equipment || null,
      status: trip.status || trip.executionStatus || trip.tourState || null,
      contentHash,
      legs: (trip.legs || []).map((leg) => ({
        loadId: leg.loadId || null,
        facilitySequence: leg.facilitySequence || null,
        executionStatus: leg.executionStatus || null,
        equipmentType: leg.equipmentType || null,
        miles: leg.miles ?? null,
        payout: leg.payout ?? null,
        tractorId: leg.tractorId || null,
        trailerId: leg.trailerId || null,
        driver: leg.driver || null,
        cpt: leg.cpt || null,
        stops: (leg.stops || []).map((s) => ({
          seq: s.seq ?? null,
          stopType: s.stopType || null,
          facilityCode: s.facilityCode || null,
          address: s.address || null,
          city: s.city || null,
          state: s.state || null,
          zip: s.zip || null,
          timeZone: s.timeZone || null,
          scheduledArrival: s.scheduledArrival || null,
          actualArrival: s.actualArrival || null,
          scheduledDeparture: s.scheduledDeparture || null,
          actualDeparture: s.actualDeparture || null,
          eta: s.eta || null,
          scheduledArrivalLocal: s.scheduledArrivalLocal || null,
          actualArrivalLocal: s.actualArrivalLocal || null,
          scheduledDepartureLocal: s.scheduledDepartureLocal || null,
          actualDepartureLocal: s.actualDepartureLocal || null,
          etaLocal: s.etaLocal || null,
          lateReason: s.lateReason || null,
          arrivalTimeSource: s.arrivalTimeSource || null,
          departureTimeSource: s.departureTimeSource || null,
        })),
      })),
      raw: trip.raw || null,
    });
  }
  return out;
}

function ymdFromIso(iso) {
  if (!iso) return null;
  const s = String(iso);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return parseDate(s);
}

function placeFromStop(stop) {
  if (!stop) return null;
  if (stop.city && stop.state) return `${stop.city}, ${String(stop.state).toUpperCase().slice(0, 2)}`;
  if (stop.facilityCode) return stop.facilityCode;
  if (stop.address) return stop.address;
  return null;
}

function addressFromStop(stop) {
  if (!stop) return null;
  const parts = [stop.address, stop.city, stop.state, stop.zip].filter(Boolean);
  return parts.length ? parts.join(', ') : stop.facilityCode || null;
}

function sectionToBucket(section, status, tab) {
  const s = String(section || '').toLowerCase();
  if (s === 'history' || String(tab || '').toUpperCase() === 'HISTORY') return 'history';
  if (s === 'upcoming' || String(tab || '').toUpperCase() === 'UPCOMING') return 'upcoming';
  if (
    s === 'in_transit' ||
    s === 'in-transit' ||
    String(tab || '').toUpperCase() === 'IN_TRANSIT'
  ) {
    return 'in_transit';
  }
  const mapped = mapLoadStatus(status);
  if (mapped && /^(Completed|Delivered|Cancelled|Rejected)$/i.test(mapped)) return 'history';
  if (mapped === 'Booked' || mapped === 'Available') return 'upcoming';
  if (mapped === 'In Transit' || mapped === 'Dispatched') return 'in_transit';
  return 'unknown';
}

function statusForBucket(bucket, status) {
  const mapped = mapLoadStatus(status);
  if (mapped) return mapped;
  if (bucket === 'history') return 'Completed';
  if (bucket === 'upcoming') return 'Booked';
  if (bucket === 'in_transit') return 'In Transit';
  return status || null;
}

/**
 * Expand one normalized trip into one or more CRM load objects.
 * Prefer legs (versionedLoadId); if no legs, emit tripId as load when valid.
 */
export function tripsToCrmLoads(trips) {
  const loads = [];
  for (const trip of trips || []) {
    if (!trip?.tripId) continue;
    const bucket = sectionToBucket(trip.section, trip.status || trip.executionStatus, trip.tab);
    const loadStatus = statusForBucket(
      bucket,
      trip.executionStatus || trip.tourState || trip.status,
    );
    const legs = Array.isArray(trip.legs) && trip.legs.length ? trip.legs : [null];

    for (const leg of legs) {
      const stops = leg && Array.isArray(leg.stops) ? [...leg.stops] : [];
      stops.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      const first = stops[0] || null;
      const last = stops.length > 1 ? stops[stops.length - 1] : stops[0] || null;

      let loadId = (leg && leg.loadId) || trip.tripId;
      if (loadId) loadId = String(loadId).trim().toUpperCase();
      if (!isValidRelayLoadId(loadId)) {
        if (isValidRelayLoadId(trip.tripId)) loadId = String(trip.tripId).trim().toUpperCase();
        else continue;
      }

      const parentTripId =
        trip.tripId && String(trip.tripId).toUpperCase() !== loadId
          ? String(trip.tripId).toUpperCase()
          : null;

      const pickupDate =
        ymdFromIso(first?.scheduledArrival || first?.actualArrival || first?.eta) || null;
      const deliveryDate =
        ymdFromIso(
          last?.scheduledArrival || last?.actualArrival || last?.eta || last?.scheduledDeparture,
        ) || null;

      const driverRaw =
        sanitizeDriverName(leg?.driver) ||
        sanitizeDriverName(trip.driver) ||
        leg?.driver ||
        trip.driver ||
        null;

      const notesParts = [];
      if (first?.scheduledArrivalLocal) notesParts.push(`PU ${first.scheduledArrivalLocal}`);
      if (last?.scheduledArrivalLocal || last?.cptLocal) {
        notesParts.push(`DEL ${last.scheduledArrivalLocal || last?.etaLocal || ''}`.trim());
      }
      if (leg?.cptLocal) notesParts.push(`CPT ${leg.cptLocal}`);

      loads.push({
        load_id: loadId,
        amazon_ref_id: null,
        parent_trip_id: parentTripId && isValidRelayLoadId(parentTripId) ? parentTripId : null,
        load_status: loadStatus,
        trip_bucket: bucket === 'unknown' ? null : bucket,
        pickup_location: placeFromStop(first),
        delivery_location: placeFromStop(last),
        pickup_address: addressFromStop(first),
        delivery_address: addressFromStop(last),
        pickup_date: pickupDate,
        delivery_date: deliveryDate,
        trailer_id: leg?.trailerId || null,
        tractor_id: leg?.tractorId || null,
        trailer_type: leg?.equipmentType || trip.equipment || null,
        driver_name_raw: driverRaw,
        distance_miles: leg?.miles ?? trip.totalMiles ?? null,
        rate_gross: leg?.payout ?? trip.payout ?? null,
        arrival_actual: first?.actualArrival || last?.actualArrival || null,
        arrival_scheduled: first?.scheduledArrival || last?.scheduledArrival || null,
        arrival_address: addressFromStop(last) || addressFromStop(first),
        notes: notesParts.filter(Boolean).join(' · ') || null,
        section: 'tours',
        source: 'relay_entitiesV2',
        entity_version: trip.version ?? null,
        tile_count_tab: trip.tab || null,
      });
    }
  }
  return loads;
}
