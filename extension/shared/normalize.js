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

export function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];

  // Fri, Nov 13, 04:01 PST  |  13 Nov, 03:02 PST
  let m = s.match(
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i,
  );
  if (!m) {
    const dmy = s.match(/\b(\d{1,2})\s+([A-Za-z]+)(?:,?\s*(\d{4}))?/i);
    if (dmy) m = [dmy[0], dmy[2], dmy[1], dmy[3]];
  }
  if (!m) m = s.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
  if (m) {
    const mon = MONTHS[String(m[1]).toLowerCase()];
    if (mon != null) {
      const year = m[3] ? Number(m[3]) : new Date().getFullYear();
      return `${year}-${String(mon + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
    }
  }

  const mdy = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (mdy) {
    const year = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
    const mm = mdy[1].padStart(2, '0');
    const dd = mdy[2].padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
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

/**
 * Fill CRM-required gaps from Relay Trips cards so scrapes insert instead of
 * stalling forever when a date/location line was collapsed/hidden.
 */
export function finalizeLoadForSync(load) {
  if (!load?.load_id || !isValidRelayLoadId(load.load_id)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const pickup = load.pickup_location || load.delivery_location || 'Unknown origin';
  const delivery = load.delivery_location || load.pickup_location || 'Unknown destination';
  const pickupDate = load.pickup_date || load.delivery_date || today;
  const deliveryDate = load.delivery_date || load.pickup_date || today;
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
