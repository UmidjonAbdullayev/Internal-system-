/**
 * Exact mapping for POST /api/tours/entitiesV2.
 * Confirmed DevTools field names only — no heuristic walk.
 */

function round2(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

/** Epoch seconds (or ms if clearly ms) → ISO UTC Z. */
export function epochToIsoUtc(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000; // seconds → ms; already-ms if > 1e12
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

/**
 * Local display in stop timeZone, e.g. "13 Nov, 20:35 PST".
 */
export function formatLocalInZone(isoUtc, timeZone) {
  if (!isoUtc) return null;
  try {
    const d = new Date(isoUtc);
    if (Number.isNaN(d.getTime())) return null;
    const opts = {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    };
    if (timeZone) opts.timeZone = timeZone;
    // en-GB → "13 Nov, 20:35 GMT-8" style; normalize comma spacing
    const fmt = new Intl.DateTimeFormat('en-GB', opts);
    const parts = fmt.formatToParts(d);
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    const day = get('day');
    const month = get('month');
    const hour = get('hour');
    const minute = get('minute');
    const tz = get('timeZoneName');
    if (!day || !month) return null;
    return `${day} ${month}, ${hour}:${minute}${tz ? ` ${tz}` : ''}`.replace(/\s+/g, ' ').trim();
  } catch {
    // Invalid timeZone — fall back to UTC label
    try {
      const d = new Date(isoUtc);
      const fmt = new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
        timeZoneName: 'short',
      });
      return fmt.format(d).replace(',', '');
    } catch {
      return null;
    }
  }
}

function withLocal(iso, timeZone) {
  if (!iso) return { utc: null, local: null };
  return { utc: iso, local: formatLocalInZone(iso, timeZone) };
}

function actionTimes(actions, type) {
  if (!Array.isArray(actions)) return { planned: null, actual: null };
  const a = actions.find((x) => String(x?.type || x?.actionType || '').toUpperCase() === type);
  if (!a) return { planned: null, actual: null };
  return {
    planned: epochToIsoUtc(a.plannedTime),
    actual: epochToIsoUtc(a.actualTime),
  };
}

function mapDriverName(d) {
  if (!d || typeof d !== 'object') return null;
  const first = d.firstName != null ? String(d.firstName).trim() : '';
  const last = d.lastName != null ? String(d.lastName).trim() : '';
  // Privacy: first/last only — never phone/email
  if (!first && !last) return null;
  return { firstName: first || null, lastName: last || null };
}

function driverDisplay(d) {
  const m = mapDriverName(d);
  if (!m) return null;
  return [m.firstName, m.lastName].filter(Boolean).join(' ') || null;
}

function mapStop(stop) {
  const loc = stop?.location || {};
  const timeZone = loc.timeZone || stop?.timeZone || null;
  const checkin = actionTimes(stop?.actions, 'CHECKIN');
  const checkout = actionTimes(stop?.actions, 'CHECKOUT');
  const etaUtc = epochToIsoUtc(stop?.calculatedEstimateArrivalTime);

  const schedArr = withLocal(checkin.planned, timeZone);
  const actArr = withLocal(checkin.actual, timeZone);
  const schedDep = withLocal(checkout.planned, timeZone);
  const actDep = withLocal(checkout.actual, timeZone);
  const eta = withLocal(etaUtc, timeZone);

  return {
    seq: stop?.stopSequenceNumber ?? null,
    stopType: stop?.stopType ?? null,
    facilityCode: stop?.locationCode ?? loc.locationCode ?? null,
    address: loc.line1 ?? null,
    city: loc.city ?? null,
    state: loc.state ?? null,
    zip: loc.postalCode ?? null,
    timeZone,
    scheduledArrival: schedArr.utc,
    scheduledArrivalLocal: schedArr.local,
    actualArrival: actArr.utc,
    actualArrivalLocal: actArr.local,
    scheduledDeparture: schedDep.utc,
    scheduledDepartureLocal: schedDep.local,
    actualDeparture: actDep.utc,
    actualDepartureLocal: actDep.local,
    eta: eta.utc,
    etaLocal: eta.local,
  };
}

function mapLeg(load) {
  const trailer = Array.isArray(load?.trailerDetails) ? load.trailerDetails[0] : null;
  const driver0 = Array.isArray(load?.driverList) ? load.driverList[0] : null;
  const cptUtc = epochToIsoUtc(load?.criticalPullTime);
  const stops = Array.isArray(load?.stops) ? load.stops.map(mapStop) : [];

  return {
    loadId: load?.versionedLoadId?.id ?? null,
    facilitySequence: load?.facilitySequence ?? null,
    executionStatus: load?.executionStatus ?? null,
    equipmentType: load?.equipmentType ?? null,
    miles: load?.distance?.value != null ? Number(load.distance.value) : null,
    payout: round2(load?.payout?.value),
    tractorId: load?.tractorDetail?.assetId ?? null,
    trailerId: trailer?.assetId ?? null,
    driver: driverDisplay(driver0),
    cpt: cptUtc,
    cptLocal: null, // filled if we have a stop TZ; use first stop TZ below
    stops,
  };
}

function mapTrip(entity, requestBody) {
  const tab = requestBody?.tileCountTab ?? null;
  const totalMiles = entity?.totalDistance?.value != null ? Number(entity.totalDistance.value) : null;
  const payout = round2(entity?.payout?.value);
  const currency = entity?.payout?.unit ?? null;
  let ratePerMile = null;
  if (payout != null && totalMiles && totalMiles > 0) {
    ratePerMile = round2(payout / totalMiles);
  }

  const costItems = Array.isArray(entity?.aggregatedCostItems)
    ? entity.aggregatedCostItems.map((c) => ({
        name: c?.name ?? null,
        amount: round2(c?.monetaryAmount?.value),
      }))
    : [];

  const drivers = Array.isArray(entity?.drivers)
    ? entity.drivers.map(mapDriverName).filter(Boolean)
    : [];

  const legs = Array.isArray(entity?.loads) ? entity.loads.map(mapLeg) : [];

  // Attach CPT local using first stop timezone when available
  for (const leg of legs) {
    const tz = leg.stops.find((s) => s.timeZone)?.timeZone || null;
    if (leg.cpt && tz) leg.cptLocal = formatLocalInZone(leg.cpt, tz);
  }

  return {
    tripId: entity?.id ?? null,
    version: entity?.version ?? null,
    tab,
    section: tabToSection(tab),
    tourState: entity?.tourState ?? null,
    executionStatus: entity?.executionStatus ?? null,
    status: entity?.executionStatus || entity?.tourState || null,
    workType: entity?.workType ?? null,
    businessType: entity?.businessType ?? null,
    startTime: epochToIsoUtc(entity?.startTime),
    endTime: epochToIsoUtc(entity?.endTime),
    totalMiles,
    payout,
    currency,
    ratePerMile,
    costItems,
    drivers,
    equipment: legs.find((l) => l.equipmentType)?.equipmentType || null,
    driver: drivers[0] ? [drivers[0].firstName, drivers[0].lastName].filter(Boolean).join(' ') : legs.find((l) => l.driver)?.driver || null,
    legs,
    raw: entity,
  };
}

function tabToSection(tab) {
  const t = String(tab || '').toUpperCase();
  if (t === 'HISTORY') return 'history';
  if (t === 'UPCOMING') return 'upcoming';
  if (t === 'IN_TRANSIT' || t === 'INTRANSIT') return 'in_transit';
  return 'unknown';
}

/**
 * Parse entitiesV2 response + request body → normalized trips.
 */
export function extractTrips(url, data, requestBody = null) {
  try {
    if (!data || typeof data !== 'object') return [];
    const entities = Array.isArray(data.entities) ? data.entities : [];
    const trips = [];
    for (const entity of entities) {
      if (!entity) continue;
      const trip = mapTrip(entity, requestBody);
      // Never drop for missing fields — only skip if no id at all
      if (!trip.tripId) continue;
      trips.push(trip);
    }
    return trips;
  } catch {
    return [];
  }
}

export function countTripStats(trips) {
  let legs = 0;
  let stops = 0;
  for (const t of trips || []) {
    for (const l of t.legs || []) {
      legs += 1;
      stops += (l.stops || []).length;
    }
  }
  return { trips: (trips || []).length, legs, stops };
}

export function tripContentHashPayload(trip) {
  return JSON.stringify({
    tripId: trip.tripId,
    version: trip.version,
    tab: trip.tab,
    tourState: trip.tourState,
    executionStatus: trip.executionStatus,
    totalMiles: trip.totalMiles,
    payout: trip.payout,
    legs: (trip.legs || []).map((l) => ({
      loadId: l.loadId,
      miles: l.miles,
      payout: l.payout,
      tractorId: l.tractorId,
      trailerId: l.trailerId,
      driver: l.driver,
      cpt: l.cpt,
      stops: l.stops,
    })),
  });
}

export async function hashString(s) {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** @deprecated — details pattern removed; entitiesV2 is complete. */
export function detectDetailsPattern() {
  return null;
}
