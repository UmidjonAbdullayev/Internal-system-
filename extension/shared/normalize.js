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

export function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
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
    'distance_miles',
    'rate_gross',
    'additional_charges',
    'payment_date',
    'driver_name_raw',
  ];
  const normalized = keys.map((k) => `${k}=${load[k] ?? ''}`).join('|');
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A load is syncable only when required CRM fields are present.
 * Incomplete rows must not be marked Synced.
 */
export function isCompleteLoad(load) {
  return Boolean(
    load?.load_id &&
      load?.load_status &&
      load?.pickup_location &&
      load?.delivery_location &&
      load?.pickup_date &&
      load?.delivery_date
  );
}

export function isCompletePayment(payment) {
  return Boolean(payment?.reference_id || payment?.amazon_ref_id) &&
    payment?.amount != null &&
    payment?.payment_date;
}
