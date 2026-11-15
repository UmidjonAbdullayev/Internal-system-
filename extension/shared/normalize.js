/** Map visible Relay text → CRM enums. Only maps known values; never invents. */

const LOAD_STATUS_MAP = [
  [/cancel/i, 'Cancelled'],
  [/reject/i, 'Rejected'],
  [/complete/i, 'Completed'],
  [/deliver/i, 'Delivered'],
  [/in[\s-]?transit|en[\s-]?route|on[\s-]?route|loaded|picked\s*up/i, 'In Transit'],
  [/dispatch/i, 'Dispatched'],
  [/book|confirm|award/i, 'Booked'],
  [/available|open/i, 'Available'],
];

const PAYMENT_STATUS_MAP = [
  [/disput/i, 'Disputed'],
  [/hold/i, 'On Hold'],
  [/paid|settled|deposited/i, 'Paid'],
  [/process/i, 'Processing'],
  [/pend/i, 'Pending'],
  [/not\s*received|unpaid|outstanding/i, 'Not Received'],
];

export function mapLoadStatus(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  for (const [re, value] of LOAD_STATUS_MAP) {
    if (re.test(s)) return value;
  }
  return null;
}

export function mapPaymentStatus(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  for (const [re, value] of PAYMENT_STATUS_MAP) {
    if (re.test(s)) return value;
  }
  return null;
}

export function parseMoney(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function parseMiles(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

/**
 * Reject bogus parses: epoch leftovers (1969-12-31), 2-digit-year mdy (12/31/44 → 2044),
 * and Date() coercions of non-dates ("Stop 1", "Distance 450").
 */
export function isPlausibleRelayDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return false;
  }
  const now = new Date();
  const min = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
  const max = new Date(Date.UTC(now.getUTCFullYear() + 1, 11, 31));
  return dt >= min && dt <= max;
}

function formatYmd(year, monthIndex, day) {
  const y = Number(year);
  const m = Number(monthIndex);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 2000 || y > 2100 || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isPlausibleRelayDate(iso) ? iso : null;
}

/**
 * Parse Relay schedule strings only. Never falls back to bare `new Date(s)` —
 * that produced Dec 31 / year-2044 / year-0450 garbage from money, stops, miles.
 */
export function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s.length > 120) return null;
  // Reject money / miles / ids masquerading as dates
  if (/^\$/.test(s) || /\bmi\b/i.test(s) || /^T-[A-Z0-9]/i.test(s)) return null;

  const iso = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && isPlausibleRelayDate(iso[1])) return iso[1];

  const hasWeekday = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(s);
  const hasTime = /\b\d{1,2}:\d{2}\b/.test(s);

  // Fri, Nov 13, 04:01 PST  |  13 Nov, 03:02 PST
  let m = s.match(
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i,
  );
  if (!m) {
    const dmy = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})(?:,?\s*(\d{4}))?(?:\s|,|$)/i);
    if (dmy && MONTHS[String(dmy[2]).toLowerCase()] != null) {
      m = [dmy[0], dmy[2], dmy[1], dmy[3]];
    }
  }
  if (!m) {
    const md = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s*(\d{4}))?(?:\s|,|$)/i);
    if (md && MONTHS[String(md[1]).toLowerCase()] != null) {
      m = md;
    }
  }
  if (m) {
    const mon = MONTHS[String(m[1]).toLowerCase()];
    if (mon != null) {
      const year = m[3] ? Number(m[3]) : null;
      // Bare "Nov 20" / "Dec 31" (week headers) need weekday, time, or explicit year
      if (year == null && !hasWeekday && !hasTime) return null;
      return formatYmd(year ?? new Date().getFullYear(), mon, Number(m[2]));
    }
  }

  // Require 4-digit year for numeric dates — "12/31/44" must not become 2044-12-31
  const mdy = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const year = Number(mdy[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return formatYmd(year, month - 1, day);
    }
  }
  return null;
}

/**
 * Relay trip/leg IDs only — reject date strings and other scrapes that
 * used a schedule cell as load_id (e.g. "Sep 29, 2026").
 */
export function isValidRelayLoadId(id) {
  if (id == null) return false;
  const s = String(id).trim();
  if (!s || s.length < 6 || s.length > 40) return false;
  if (/\s/.test(s)) return false; // real IDs never contain spaces
  if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)/i.test(s)) return false;
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(s)) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return false;
  if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(s)) return false;
  return /^T-[A-Z0-9]{5,}$/i.test(s) || /^[0-9]{2,3}[A-Z0-9]{5,}$/i.test(s);
}

/** Stable content hash for change detection (CRM-required fields only). */
export async function hashLoadPayload(load) {
  const keys = [
    'load_id',
    'amazon_ref_id',
    'load_status',
    'payment_status',
    'pickup_location',
    'delivery_location',
    'pickup_date',
    'delivery_date',
    'trailer_id',
    'trailer_type',
    'tractor_id',
    'parent_trip_id',
    'trip_bucket',
    'status_bar_state',
    'status_stop_index',
    'job_type',
    'distance_miles',
    'rate_gross',
    'additional_charges',
    'payment_date',
    'driver_name_raw',
    'notes',
  ];
  const normalized = keys.map((k) => `${k}=${load[k] ?? ''}`).join('|');
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeLocation(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^\$/.test(s)) return null; // money mistaken for route
  if (/^\d[\d,]*\.?\d*\s*$/.test(s)) return null;
  if (/^\/?Live$/i.test(s)) return null;
  if (s.length < 3) return null;
  return s.slice(0, 120);
}

/**
 * Fill CRM-required gaps from Relay Trips cards so scrapes insert instead of
 * stalling forever when a date/location line was collapsed/hidden.
 */
export function finalizeLoadForSync(load) {
  if (!load?.load_id || !isValidRelayLoadId(load.load_id)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const pickupLoc = sanitizeLocation(load.pickup_location);
  const deliveryLoc = sanitizeLocation(load.delivery_location);
  const pickup = pickupLoc || deliveryLoc || 'Unknown origin';
  const delivery = deliveryLoc || pickupLoc || 'Unknown destination';

  const pickupDateRaw = parseDate(load.pickup_date) || (isPlausibleRelayDate(load.pickup_date) ? load.pickup_date : null);
  const deliveryDateRaw =
    parseDate(load.delivery_date) || (isPlausibleRelayDate(load.delivery_date) ? load.delivery_date : null);
  const pickupDate = pickupDateRaw || deliveryDateRaw || today;
  const deliveryDate = deliveryDateRaw || pickupDateRaw || today;

  let status = load.load_status;
  if (!status) {
    if (load.trip_bucket === 'history') status = 'Completed';
    else if (load.trip_bucket === 'upcoming') status = 'Booked';
    else status = 'In Transit';
  }
  return {
    ...load,
    load_status: status,
    pickup_location: pickup,
    delivery_location: delivery,
    pickup_date: pickupDate,
    delivery_date: deliveryDate,
    payment_status: load.payment_status || 'Not Received',
  };
}

/**
 * A load is syncable only when required CRM fields are present.
 * Incomplete rows must not be marked Synced.
 */
export function isCompleteLoad(load) {
  if (!isValidRelayLoadId(load?.load_id)) return false;
  const finalized = finalizeLoadForSync(load);
  return Boolean(
    finalized?.load_id &&
      finalized?.load_status &&
      finalized?.pickup_location &&
      finalized?.delivery_location &&
      finalized?.pickup_date &&
      finalized?.delivery_date
  );
}

export function isCompletePayment(payment) {
  return Boolean(payment?.reference_id || payment?.amazon_ref_id) &&
    payment?.amount != null &&
    payment?.payment_date;
}
