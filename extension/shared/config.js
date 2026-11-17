/** Shared extension config — no service-role keys, no Relay credentials.
 *  Target: Internal system Supabase project iiyqkdjwxlnfqvlidbqr
 */

export const SUPABASE_URL = 'https://iiyqkdjwxlnfqvlidbqr.supabase.co';

/** Anon/publishable key only — never service_role. */
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpeXFrZGp3eGxuZnF2bGlkYnFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODE5NjEsImV4cCI6MjExMDE1Nzk2MX0.ZYLoih1BegKKx-UN-aaz4qMuriJ_vr05QRW4hUR_zm8';

export const RELAY_SYNC_FN = `${SUPABASE_URL}/functions/v1/relay-sync`;
export const RELAY_TELEGRAM_FN = `${SUPABASE_URL}/functions/v1/relay-telegram`;

export const EXT_USERNAME = 'admin';
export const EXT_PASSWORD = 'qwerty';

export const DEBUG = true;

/** Confirmed Trips API (only endpoint we capture). */
export const ENTITIES_V2_PATH = '/api/tours/entitiesV2';
export const ENTITIES_V2_URL = 'https://relay.amazon.com/api/tours/entitiesV2';

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
    ],
    required: true,
    collects: 'entitiesV2 trips/loads/stops',
  },
  {
    id: 'load_detail',
    label: 'Load detail',
    urlHints: ['/tour/t-', '/trips/t-', '/load/'],
    required: false,
    collects: 'legs/stops from entitiesV2 (no expand)',
  },
  {
    id: 'payments',
    label: 'Payment information',
    urlHints: ['/payment', '/settlement', '/invoice'],
    required: true,
    collects: 'payment JSON when captured on Payments pages',
  },
];

export function isTripsBoardUrl(url) {
  const u = String(url || '').toLowerCase();
  if (/\/trips?\/(t-[a-z0-9]+|[0-9]{2,3}[a-z0-9]{5,})(?:[/?#]|$)/i.test(u)) return false;
  return /\/trips?(?:\/(?:upcoming|in[_-]?transit|history|active|all|list)?)?(?:[/?#]|$)/i.test(u);
}

export const SYNC_ALARM = 'relay-sync-flush';
export const CAPTURE_FLUSH_ALARM = 'relay-capture-flush';

/** Raw entitiesV2 ring buffer (url, timestamp, requestBody, json). */
export const MAX_RAW_CAPTURES = 20;

export const CAPTURE_BATCH_MS = 5000;
export const CAPTURE_BATCH_SIZE = 50;

/** Optional History pagination replay (setting default OFF). */
export const HISTORY_PAGE_SIZE = 100;
export const HISTORY_MIN_INTERVAL_MS = 2000;

export const SYNC_FLUSH_MINUTES = 1;
export const FLUSH_TIMEOUT_MS = 90 * 1000;
export const FLUSH_BATCH_SIZE = 20;
export const FLUSH_BACKOFF_BASE_MS = 2000;
export const FLUSH_BACKOFF_MAX_MS = 60000;

export const TYPICAL_FULL_SYNC_SECONDS = 'passive';
export const HISTORY_SKIP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const RAW_CAPTURES_KEY = 'relayRawCaptures';
export const TRIP_HASH_KEY = 'relayTripHashes';
export const LAST_ENTITIES_REQ_KEY = 'relayLastEntitiesRequest';
