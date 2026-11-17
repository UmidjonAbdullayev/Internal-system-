/**
 * Heuristic recursive trip/leg/stop extraction from Relay JSON.
 * No hardcoded Amazon field names — match keys by substring (case-insensitive).
 */

const ID_VALUE_RE = /^(?:T-)?[A-Z0-9]{6,}$/i;
const FACILITY_RE = /^[A-Z]{3,4}\d[A-Z0-9]?$/i;
const MAX_WALK_NODES = 8000;

function keyLower(k) {
  return String(k || '').toLowerCase();
}

function keyHas(k, parts) {
  const s = keyLower(k);
  return parts.some((p) => s.includes(p));
}

function isIdLikeValue(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (!s || s.length < 6 || s.length > 40 || /\s/.test(s)) return false;
  return ID_VALUE_RE.test(s);
}

function isFacilityCode(v) {
  if (v == null) return false;
  const s = String(v).trim();
  return FACILITY_RE.test(s);
}

/**
 * Normalize times: epoch ms, epoch seconds, ISO → ISO string (keep tz if present).
 */
export function normalizeTime(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : null;
    if (ms == null) return null;
    try {
      return new Date(ms).toISOString();
    } catch {
      return null;
    }
  }
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    const ms = s.length >= 13 ? n : n * 1000;
    try {
      return new Date(ms).toISOString();
    } catch {
      return null;
    }
  }
  // ISO-like (with or without timezone)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = Date.parse(s);
    if (!Number.isNaN(d)) {
      // Prefer original string when it already carries timezone / offset
      if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) || /T/.test(s)) return s;
      try {
        return new Date(d).toISOString();
      } catch {
        return s;
      }
    }
    return s;
  }
  const d = Date.parse(s);
  if (!Number.isNaN(d)) {
    try {
      return new Date(d).toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function pickNumber(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickString(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function objectEntries(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.entries(obj);
}

function findIdFields(obj) {
  const ids = [];
  for (const [k, v] of objectEntries(obj)) {
    if (!keyHas(k, ['id']) || keyHas(k, ['facility', 'trailer', 'tractor', 'driver', 'vehicle'])) {
      continue;
    }
    if (isIdLikeValue(v)) ids.push({ key: k, value: String(v).trim().toUpperCase() });
  }
  return ids;
}

function arrayChildObjects(obj) {
  const arrays = [];
  for (const [k, v] of objectEntries(obj)) {
    if (!Array.isArray(v) || !v.length) continue;
    if (v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      arrays.push({ key: k, items: v });
    }
  }
  return arrays;
}

function looksLikeStop(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  let addressScore = 0;
  let timeScore = 0;
  let facility = null;
  for (const [k, v] of objectEntries(obj)) {
    if (v == null || v === '') continue;
    if (keyHas(k, ['address', 'line1', 'line2', 'city', 'state', 'postal', 'zip', 'street'])) {
      addressScore += 1;
    }
    if (keyHas(k, ['facility', 'warehouse', 'locationcode', 'location_code', 'fc'])) {
      if (isFacilityCode(v) || (typeof v === 'string' && v.trim().length >= 3)) {
        facility = String(v).trim().toUpperCase();
        addressScore += 1;
      }
    }
    if (typeof v === 'string' && isFacilityCode(v) && keyHas(k, ['code', 'id', 'name', 'loc'])) {
      facility = String(v).trim().toUpperCase();
      addressScore += 1;
    }
    if (
      keyHas(k, [
        'arrival',
        'departure',
        'scheduled',
        'actual',
        'cpt',
        'time',
        'date',
        'eta',
        'ata',
        'etd',
        'atd',
      ])
    ) {
      timeScore += 1;
    }
  }
  // Nested address object
  for (const [k, v] of objectEntries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && keyHas(k, ['address', 'location', 'geo'])) {
      addressScore += 1;
      for (const [ak, av] of objectEntries(v)) {
        if (keyHas(ak, ['line1', 'city', 'state', 'postal', 'zip', 'address']) && av) {
          addressScore += 1;
        }
      }
    }
  }
  return addressScore >= 1 && (timeScore >= 1 || facility || addressScore >= 2);
}

function extractStop(obj, seqHint) {
  let facilityCode = null;
  let address = null;
  let city = null;
  let state = null;
  let zip = null;
  let scheduledArrival = null;
  let actualArrival = null;
  let scheduledDeparture = null;
  let actualDeparture = null;
  let cpt = null;
  let seq = seqHint;

  const applyAddressObj = (addr) => {
    if (!addr || typeof addr !== 'object') return;
    for (const [k, v] of objectEntries(addr)) {
      if (v == null || v === '') continue;
      if (keyHas(k, ['line1', 'address1', 'street']) && !address) address = String(v).trim();
      else if (keyHas(k, ['address']) && !keyHas(k, ['line2', 'type']) && !address) {
        address = String(v).trim();
      }
      if (keyHas(k, ['city']) && !city) city = String(v).trim();
      if (keyHas(k, ['state', 'province', 'region']) && !state) state = String(v).trim();
      if (keyHas(k, ['postal', 'zip']) && !zip) zip = String(v).trim();
    }
  };

  for (const [k, v] of objectEntries(obj)) {
    if (v == null || v === '') continue;
    const kl = keyLower(k);

    if (keyHas(k, ['seq', 'sequence', 'stopnumber', 'stop_number', 'index', 'order']) && typeof v === 'number') {
      seq = v;
    }
    if (isFacilityCode(v) && (keyHas(k, ['facility', 'code', 'loc', 'warehouse', 'fc']) || kl === 'id')) {
      if (!facilityCode) facilityCode = String(v).trim().toUpperCase();
    }
    if (keyHas(k, ['facility']) && typeof v === 'string' && !facilityCode) {
      facilityCode = String(v).trim().toUpperCase();
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && keyHas(k, ['address', 'location', 'geo'])) {
      applyAddressObj(v);
    }
    if (keyHas(k, ['line1', 'street', 'address1']) && typeof v === 'string') address = address || v.trim();
    if (keyHas(k, ['city']) && typeof v === 'string') city = city || v.trim();
    if (keyHas(k, ['state', 'province']) && typeof v === 'string' && v.length <= 24) {
      state = state || v.trim();
    }
    if (keyHas(k, ['postal', 'zip']) && (typeof v === 'string' || typeof v === 'number')) {
      zip = zip || String(v).trim();
    }
    if (keyHas(k, ['address']) && typeof v === 'string' && v.length > 8 && !address) {
      address = v.trim();
    }

    const t = normalizeTime(v);
    if (!t) continue;
    if (keyHas(k, ['cpt'])) cpt = cpt || t;
    else if (keyHas(k, ['actual']) && keyHas(k, ['arrival'])) actualArrival = actualArrival || t;
    else if (keyHas(k, ['actual']) && keyHas(k, ['depart'])) actualDeparture = actualDeparture || t;
    else if (keyHas(k, ['sched']) && keyHas(k, ['arrival'])) scheduledArrival = scheduledArrival || t;
    else if (keyHas(k, ['sched']) && keyHas(k, ['depart'])) scheduledDeparture = scheduledDeparture || t;
    else if (keyHas(k, ['arrival']) && keyHas(k, ['actual'])) actualArrival = actualArrival || t;
    else if (keyHas(k, ['arrival']) && !keyHas(k, ['actual'])) scheduledArrival = scheduledArrival || t;
    else if (keyHas(k, ['depart']) && keyHas(k, ['actual'])) actualDeparture = actualDeparture || t;
    else if (keyHas(k, ['depart']) && !keyHas(k, ['actual'])) scheduledDeparture = scheduledDeparture || t;
    else if (kl.includes('eta') || kl === 'arrival' || kl === 'arrivaltime') {
      scheduledArrival = scheduledArrival || t;
    } else if (kl.includes('ata')) actualArrival = actualArrival || t;
    else if (kl.includes('etd')) scheduledDeparture = scheduledDeparture || t;
    else if (kl.includes('atd')) actualDeparture = actualDeparture || t;
  }

  // Nested facility / location code
  for (const [k, v] of objectEntries(obj)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    if (!keyHas(k, ['facility', 'location', 'warehouse', 'stop'])) continue;
    for (const [fk, fv] of objectEntries(v)) {
      if (isFacilityCode(fv) && !facilityCode) facilityCode = String(fv).trim().toUpperCase();
      if (keyHas(fk, ['code', 'id', 'name']) && typeof fv === 'string' && isFacilityCode(fv) && !facilityCode) {
        facilityCode = fv.trim().toUpperCase();
      }
      if (keyHas(fk, ['address', 'location'])) applyAddressObj(fv);
    }
  }

  return {
    seq: seq != null ? seq : null,
    facilityCode: facilityCode || null,
    address: address || null,
    city: city || null,
    state: state || null,
    zip: zip || null,
    scheduledArrival: scheduledArrival || null,
    actualArrival: actualArrival || null,
    scheduledDeparture: scheduledDeparture || null,
    actualDeparture: actualDeparture || null,
    cpt: cpt || null,
  };
}

function collectStopsFromObj(obj) {
  const stops = [];
  for (const { key, items } of arrayChildObjects(obj)) {
    if (!keyHas(key, ['stop', 'stops', 'waypoint', 'location', 'call'])) continue;
    items.forEach((item, i) => {
      if (looksLikeStop(item) || keyHas(key, ['stop'])) {
        stops.push(extractStop(item, i + 1));
      }
    });
  }
  // Sometimes stops are nested one level deeper
  if (!stops.length) {
    for (const [, v] of objectEntries(obj)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      for (const { key, items } of arrayChildObjects(v)) {
        if (!keyHas(key, ['stop', 'stops'])) continue;
        items.forEach((item, i) => stops.push(extractStop(item, i + 1)));
      }
    }
  }
  return stops;
}

function extractEquipmentDriver(obj) {
  let equipment = null;
  let driver = null;
  let tractorId = null;
  let trailerId = null;
  let miles = null;
  let payout = null;
  let loadId = null;
  let status = null;

  for (const [k, v] of objectEntries(obj)) {
    if (v == null || v === '') continue;
    if (keyHas(k, ['trailer']) && !keyHas(k, ['type']) && (typeof v === 'string' || typeof v === 'number')) {
      trailerId = trailerId || String(v).trim();
    }
    if (keyHas(k, ['tractor', 'powerunit', 'power_unit', 'truck']) && (typeof v === 'string' || typeof v === 'number')) {
      tractorId = tractorId || String(v).trim();
    }
    if (keyHas(k, ['equipment', 'trailer_type', 'trailertype', 'vehicletype']) && typeof v === 'string') {
      equipment = equipment || v.trim();
    }
    if (keyHas(k, ['driver']) && typeof v === 'string' && !keyHas(k, ['id', 'license'])) {
      driver = driver || v.trim();
    }
    if (keyHas(k, ['driver']) && v && typeof v === 'object') {
      for (const [dk, dv] of objectEntries(v)) {
        if (keyHas(dk, ['name']) && typeof dv === 'string') driver = driver || dv.trim();
      }
    }
    if (keyHas(k, ['mile', 'distance']) && !keyHas(k, ['rate', 'per'])) {
      miles = miles ?? pickNumber(v);
    }
    if (keyHas(k, ['payout', 'pay', 'rate', 'price', 'amount', 'gross']) && !keyHas(k, ['permile', 'per_mile', 'rpm'])) {
      payout = payout ?? pickNumber(v);
    }
    if (keyHas(k, ['status', 'state']) && typeof v === 'string' && v.length < 40) {
      status = status || v.trim();
    }
    if (
      keyHas(k, ['id', 'load', 'shipment', 'tour']) &&
      isIdLikeValue(v) &&
      !keyHas(k, ['trailer', 'tractor', 'driver', 'facility', 'parent', 'trip'])
    ) {
      loadId = loadId || String(v).trim().toUpperCase();
    }
  }
  return { equipment, driver, tractorId, trailerId, miles, payout, loadId, status };
}

function looksLikeLeg(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const stops = collectStopsFromObj(obj);
  if (stops.length >= 1) return true;
  const ids = findIdFields(obj);
  if (!ids.length) return false;
  // Leg-ish: has id + some logistics fields
  const meta = extractEquipmentDriver(obj);
  return Boolean(meta.trailerId || meta.tractorId || meta.miles != null || meta.payout != null);
}

function extractLeg(obj) {
  const meta = extractEquipmentDriver(obj);
  const ids = findIdFields(obj);
  const loadId =
    meta.loadId ||
    ids.find((x) => /load|shipment|tour|leg/i.test(x.key))?.value ||
    ids[0]?.value ||
    null;
  const stops = collectStopsFromObj(obj);
  return {
    loadId,
    miles: meta.miles,
    payout: meta.payout,
    tractorId: meta.tractorId,
    trailerId: meta.trailerId,
    stops,
    _status: meta.status,
    _equipment: meta.equipment,
    _driver: meta.driver,
  };
}

function inferSection(url, status) {
  const u = String(url || '').toLowerCase();
  const s = String(status || '').toLowerCase();
  if (/history|completed|delivered|cancelled|canceled|archive/.test(u) || /complete|deliver|cancel|reject/.test(s)) {
    return 'history';
  }
  if (/in[_-]?transit|en[_-]?route|active|live/.test(u) || /transit|en.?route|picked|loaded|dispatched/.test(s)) {
    return 'in_transit';
  }
  if (/upcoming|scheduled|booked|planned|future/.test(u) || /book|schedul|upcoming|confirm|award/.test(s)) {
    return 'upcoming';
  }
  if (/upcoming|in[_-]?transit|history/.test(u)) {
    if (u.includes('history')) return 'history';
    if (u.includes('transit')) return 'in_transit';
    if (u.includes('upcoming')) return 'upcoming';
  }
  return 'unknown';
}

function scoreTripCandidate(obj) {
  const ids = findIdFields(obj);
  if (!ids.length) return 0;
  let score = ids.length;
  const arrays = arrayChildObjects(obj);
  for (const { key, items } of arrays) {
    if (keyHas(key, ['leg', 'load', 'shipment', 'tour', 'stop', 'child', 'segment'])) {
      score += 2;
    }
    const stopish = items.filter((it) => looksLikeStop(it) || looksLikeLeg(it)).length;
    score += Math.min(4, stopish);
  }
  return score;
}

function buildTripFromObj(obj, url) {
  const ids = findIdFields(obj);
  if (!ids.length) return null;

  // Prefer keys that look like trip/tour ids
  const tripId =
    ids.find((x) => /trip|tour|shipment/i.test(x.key))?.value ||
    ids.find((x) => /^T-/i.test(x.value))?.value ||
    ids[0].value;

  const meta = extractEquipmentDriver(obj);
  let legs = [];

  for (const { key, items } of arrayChildObjects(obj)) {
    if (keyHas(key, ['stop', 'stops']) && !keyHas(key, ['leg', 'load', 'shipment'])) {
      // Stops directly on trip → single synthetic leg
      continue;
    }
    if (keyHas(key, ['leg', 'load', 'shipment', 'tour', 'segment', 'child', 'item'])) {
      for (const item of items) {
        if (looksLikeLeg(item) || findIdFields(item).length) {
          legs.push(extractLeg(item));
        }
      }
    }
  }

  const directStops = collectStopsFromObj(obj);
  if (!legs.length && directStops.length) {
    legs = [
      {
        loadId: tripId,
        miles: meta.miles,
        payout: meta.payout,
        tractorId: meta.tractorId,
        trailerId: meta.trailerId,
        stops: directStops,
      },
    ];
  }

  // Trip with id + child array that has stops nested in children
  if (!legs.length) {
    for (const { items } of arrayChildObjects(obj)) {
      for (const item of items) {
        const childStops = collectStopsFromObj(item);
        if (childStops.length || looksLikeLeg(item)) {
          legs.push(extractLeg(item));
        }
      }
    }
  }

  const status = meta.status;
  const section = inferSection(url, status);
  const totalMiles = meta.miles ?? pickNumber(
    ...legs.map((l) => l.miles).filter((n) => n != null),
  );
  const payout = meta.payout;
  let ratePerMile = null;
  if (payout != null && totalMiles) ratePerMile = Math.round((payout / totalMiles) * 1000) / 1000;
  for (const [k, v] of objectEntries(obj)) {
    if (keyHas(k, ['permile', 'per_mile', 'rpm', 'ratepermile']) && ratePerMile == null) {
      ratePerMile = pickNumber(v);
    }
  }

  return {
    tripId,
    section,
    status: status || null,
    totalMiles: totalMiles ?? null,
    payout: payout ?? null,
    ratePerMile,
    equipment: meta.equipment || legs.find((l) => l._equipment)?._equipment || null,
    driver: meta.driver || legs.find((l) => l._driver)?._driver || null,
    legs: legs.map(({ loadId, miles, payout: p, tractorId, trailerId, stops }) => ({
      loadId: loadId || null,
      miles: miles ?? null,
      payout: p ?? null,
      tractorId: tractorId || null,
      trailerId: trailerId || null,
      stops: stops || [],
    })),
    raw: obj,
  };
}

/**
 * Walk JSON recursively; return normalized trips.
 * Never throws — returns [].
 */
export function extractTrips(url, data) {
  const trips = [];
  const seen = new Set();
  let nodes = 0;

  try {
    const visit = (node, depth) => {
      if (nodes++ > MAX_WALK_NODES || depth > 14) return;
      if (node == null) return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item, depth + 1);
        return;
      }
      if (typeof node !== 'object') return;

      if (scoreTripCandidate(node) >= 2) {
        const trip = buildTripFromObj(node, url);
        if (trip?.tripId && !seen.has(trip.tripId)) {
          // Require either legs/stops OR at least a solid id (never drop)
          seen.add(trip.tripId);
          trips.push(trip);
        }
      }

      for (const v of Object.values(node)) {
        if (v && typeof v === 'object') visit(v, depth + 1);
      }
    };

    visit(data, 0);
  } catch {
    return trips;
  }

  // Drop nested leg objects that were also recorded as their own "trip"
  // when a parent trip already lists them as legs.
  const legIds = new Set();
  for (const t of trips) {
    for (const leg of t.legs || []) {
      if (leg.loadId && leg.loadId !== t.tripId) legIds.add(leg.loadId);
    }
  }
  return trips.filter((t) => !legIds.has(t.tripId));
}

/** Relay trip/load ids in a URL path/query — never hostname tokens like "amazon". */
function idsInUrlPath(url) {
  try {
    const u = new URL(String(url), 'https://relay.amazon.com');
    const hay = `${u.pathname}${u.search}`;
    const found = [];
    const re = /(?:^|[^A-Z0-9-])((?:T-)?[A-Z0-9]{6,})(?=[^A-Z0-9-]|$)/gi;
    let m;
    while ((m = re.exec(hay))) {
      const id = m[1];
      // Prefer numeric-leading load ids or T- tours; skip pure alpha words
      if (/^T-/i.test(id) || /^[0-9]{2,}/.test(id)) found.push(id);
    }
    return found;
  } catch {
    return [];
  }
}

/**
 * Detect detail-endpoint patterns: URL containing a trip/load id whose
 * response yields stops. Returns { templateUrl, exampleId } or null.
 */
export function detectDetailsPattern(url, data) {
  try {
    const u = String(url || '');
    const idMatch = idsInUrlPath(u);
    if (!idMatch.length) return null;

    let hasStops = false;
    const trips = extractTrips(url, data);
    if (trips.some((t) => (t.legs || []).some((l) => (l.stops || []).length > 0))) {
      hasStops = true;
    }
    if (!hasStops) {
      const stops = collectStopsFromObj(data) || [];
      if (!stops.length && data && typeof data === 'object') {
        for (const v of Object.values(data)) {
          if (v && typeof v === 'object') {
            const s = collectStopsFromObj(v);
            if (s.length) stops.push(...s);
          }
        }
      }
      hasStops = stops.length > 0;
    }
    if (!hasStops) return null;

    const id = idMatch[0];
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Replace only in path+query, preserve host
    let parsed;
    try {
      parsed = new URL(u);
    } catch {
      return null;
    }
    const pathQ = `${parsed.pathname}${parsed.search}`.replace(
      new RegExp(esc, 'i'),
      '{ID}',
    );
    if (!pathQ.includes('{ID}')) return null;
    const templateUrl = `${parsed.origin}${pathQ}${parsed.hash || ''}`;
    return { templateUrl, exampleId: id.toUpperCase(), exampleUrl: u };
  } catch {
    return null;
  }
}

export function tripContentHashPayload(trip) {
  return JSON.stringify({
    tripId: trip.tripId,
    section: trip.section,
    status: trip.status,
    totalMiles: trip.totalMiles,
    payout: trip.payout,
    driver: trip.driver,
    equipment: trip.equipment,
    legs: (trip.legs || []).map((l) => ({
      loadId: l.loadId,
      miles: l.miles,
      payout: l.payout,
      tractorId: l.tractorId,
      trailerId: l.trailerId,
      stops: l.stops,
    })),
  });
}

export async function hashString(s) {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
