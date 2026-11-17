/** Shared extension config — no service-role keys, no Relay credentials.
 *  Target: Internal system Supabase project iiyqkdjwxlnfqvlidbqr
 *  Paste SUPABASE_ANON_KEY from Dashboard → Project Settings → API (anon/publishable).
 */

export const SUPABASE_URL = 'https://iiyqkdjwxlnfqvlidbqr.supabase.co';

/** Anon/publishable key only — never service_role. */
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpeXFrZGp3eGxuZnF2bGlkYnFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODE5NjEsImV4cCI6MjExMDE1Nzk2MX0.ZYLoih1BegKKx-UN-aaz4qMuriJ_vr05QRW4hUR_zm8';

export const RELAY_SYNC_FN = `${SUPABASE_URL}/functions/v1/relay-sync`;
export const RELAY_TELEGRAM_FN = `${SUPABASE_URL}/functions/v1/relay-telegram`;

/** Extension popup gate only — not Amazon Relay credentials. */
export const EXT_USERNAME = 'admin';
export const EXT_PASSWORD = 'qwerty';

export const DEBUG = true;

export const SECTIONS = [
  {
    id: 'tours',
    label: 'Tours / My Loads',
    urlHints: [
      '/trips/upcoming',
      '/trips/in-transit',
      '/trips/in_transit',
      '/trips/history',
      '/trips',
      '/trip',
      '/tours',
      '/tour',
      '/loads',
      '/load',
      '/work',
      '/schedule',
      '/loadboard',
      '/my-loads',
    ],
    required: true,
    collects: 'trip/load ids, tractor, trailer, driver, pay, trip_bucket, stops via API capture',
  },
  {
    id: 'load_detail',
    label: 'Load detail',
    urlHints: ['/tour/t-', '/tours/t-', '/trip/t-', '/trips/t-', '/load/'],
    required: false,
    collects: 'trailer, tractor, miles, stop detail from captured JSON',
  },
  {
    id: 'payments',
    label: 'Payment information',
    urlHints: ['/payment', '/settlement', '/invoice'],
    required: true,
    collects: 'payment_status, payment_date, settlement amounts (when JSON captured)',
  },
];

/** Board vs detail: /trips/in-transit is tours; /trips/T-XXXX is detail. */
export function isTripsBoardUrl(url) {
  const u = String(url || '').toLowerCase();
  if (/\/trips?\/(t-[a-z0-9]+|[0-9]{2,3}[a-z0-9]{5,})(?:[/?#]|$)/i.test(u)) return false;
  return /\/trips?(?:\/(?:upcoming|in[_-]?transit|history|active|all|list)?)?(?:[/?#]|$)/i.test(u);
}

export const TAB_SCAN_ALARM = 'relay-tab-scan';
export const SYNC_ALARM = 'relay-sync-flush';
export const PAYMENTS_SCAN_ALARM = 'relay-payments-scan';
export const CAPTURE_FLUSH_ALARM = 'relay-capture-flush';

/** Raw JSON capture ring buffer. */
export const MAX_RAW_CAPTURES = 200;

/** Batch new/changed trips to CRM every 5s or 50 trips. */
export const CAPTURE_BATCH_MS = 5000;
export const CAPTURE_BATCH_SIZE = 50;

/** Details refetch for trips missing stops (background, same cookies). */
export const DETAILS_MAX_PER_SECOND = 1;

/** Flush / retry. */
export const SYNC_FLUSH_MINUTES = 1;
export const FLUSH_TIMEOUT_MS = 90 * 1000;
export const FLUSH_BATCH_SIZE = 20;
export const FLUSH_BACKOFF_BASE_MS = 2000;
export const FLUSH_BACKOFF_MAX_MS = 60000;

export const TYPICAL_FULL_SYNC_SECONDS = 'passive';

/** History skip cache TTL. */
export const HISTORY_SKIP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Storage keys (alongside relayState). */
export const RAW_CAPTURES_KEY = 'relayRawCaptures';
export const TRIP_HASH_KEY = 'relayTripHashes';
export const DETAILS_PATTERN_KEY = 'relayDetailsPatterns';
