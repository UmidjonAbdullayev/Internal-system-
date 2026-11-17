/**
 * Map normalized API-capture trips → existing relay-sync load rows.
 */

import { mapLoadStatus, parseDate, isValidRelayLoadId, sanitizeDriverName } from './normalize.js';

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

function sectionToBucket(section, status) {
  const s = String(section || '').toLowerCase();
  if (s === 'history') return 'history';
  if (s === 'upcoming') return 'upcoming';
  if (s === 'in_transit' || s === 'in-transit') return 'in_transit';
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
 * Never drops for missing fields — leave nulls; finalizeLoadForSync fills gaps at flush.
 */
export function tripsToCrmLoads(trips) {
  const loads = [];
  for (const trip of trips || []) {
    if (!trip?.tripId) continue;
    const bucket = sectionToBucket(trip.section, trip.status);
    const loadStatus = statusForBucket(bucket, trip.status);
    const legs = Array.isArray(trip.legs) && trip.legs.length ? trip.legs : [{}];

    for (const leg of legs) {
      const stops = Array.isArray(leg.stops) ? [...leg.stops] : [];
      stops.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      const first = stops[0] || null;
      const last = stops.length > 1 ? stops[stops.length - 1] : stops[0] || null;

      let loadId = leg.loadId || trip.tripId;
      if (loadId) loadId = String(loadId).trim().toUpperCase();
      if (!isValidRelayLoadId(loadId)) {
        // Still emit if tripId is valid; otherwise skip invalid ids
        if (isValidRelayLoadId(trip.tripId)) loadId = String(trip.tripId).trim().toUpperCase();
        else continue;
      }

      const parentTripId =
        trip.tripId &&
        String(trip.tripId).toUpperCase() !== loadId &&
        isValidRelayLoadId(trip.tripId)
          ? String(trip.tripId).toUpperCase()
          : /^T-/i.test(trip.tripId)
            ? String(trip.tripId).toUpperCase()
            : null;

      const pickupDate =
        ymdFromIso(first?.scheduledArrival || first?.actualArrival || first?.cpt) || null;
      const deliveryDate =
        ymdFromIso(last?.scheduledArrival || last?.actualArrival || last?.cpt || last?.scheduledDeparture) ||
        null;

      loads.push({
        load_id: loadId,
        amazon_ref_id:
          leg.loadId && String(leg.loadId).toUpperCase() !== loadId
            ? String(leg.loadId).toUpperCase()
            : null,
        parent_trip_id: parentTripId && parentTripId !== loadId ? parentTripId : /^T-/i.test(trip.tripId) ? String(trip.tripId).toUpperCase() : null,
        load_status: loadStatus,
        trip_bucket: bucket === 'unknown' ? null : bucket,
        pickup_location: placeFromStop(first),
        delivery_location: placeFromStop(last),
        pickup_address: addressFromStop(first),
        delivery_address: addressFromStop(last),
        pickup_date: pickupDate,
        delivery_date: deliveryDate,
        trailer_id: leg.trailerId || null,
        tractor_id: leg.tractorId || null,
        trailer_type: trip.equipment || null,
        driver_name_raw: sanitizeDriverName(trip.driver) || trip.driver || null,
        distance_miles: leg.miles ?? trip.totalMiles ?? null,
        rate_gross: leg.payout ?? trip.payout ?? null,
        arrival_actual: first?.actualArrival || last?.actualArrival || null,
        arrival_scheduled: first?.scheduledArrival || last?.scheduledArrival || null,
        arrival_address: addressFromStop(last) || addressFromStop(first),
        notes: null,
        section: 'tours',
        source: 'relay_api_capture',
      });
    }
  }
  return loads;
}
