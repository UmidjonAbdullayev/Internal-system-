/** Shared extension config — no service-role keys, no Relay credentials. */

export const SUPABASE_URL = 'https://iiyqkdjwxlnfqvlidbqr.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpeXFrZGp3eGxuZnF2bGlkYnFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODE5NjEsImV4cCI6MjExMDE1Nzk2MX0.ZYLoih1BegKKx-UN-aaz4qMuriJ_vr05QRW4hUR_zm8';

export const RELAY_SYNC_FN = `${SUPABASE_URL}/functions/v1/relay-sync`;
export const RELAY_SNAPSHOT_FN = `${SUPABASE_URL}/functions/v1/relay-snapshot`;
export const RELAY_TELEGRAM_FN = `${SUPABASE_URL}/functions/v1/relay-telegram`;

export const EXT_USERNAME = 'admin';
export const EXT_PASSWORD = 'qwerty';

export const DEBUG = true;

export const ENTITIES_V2_PATH = '/api/tours/entitiesV2';
export const ENTITIES_V2_URL = 'https://relay.amazon.com/api/tours/entitiesV2';
/** Prefer Trips board so Relay fires entitiesV2 on first load. */
export const RELAY_TRIPS_URL = 'https://relay.amazon.com/tours/';

export const SECTIONS = [
  {
    id: 'tours',
    label: 'Tours / My Loads',
    urlHints: ['/trips', '/tours', '/tour', '/loads'],
    required: true,
    collects: 'entitiesV2 trips/loads/stops',
  },
  {
    id: 'load_detail',
    label: 'Load detail',
    urlHints: ['/tour/t-', '/trips/t-', '/load/'],
    required: false,
    collects: 'legs/stops from entitiesV2',
  },
  {
    id: 'payments',
    label: 'Payment information',
    urlHints: ['/payment', '/settlement', '/invoice'],
    required: true,
    collects: 'payment JSON when captured',
  },
];

export function isTripsBoardUrl(url) {
  const u = String(url || '').toLowerCase();
  if (/\/trips?\/(t-[a-z0-9]+|[0-9]{2,3}[a-z0-9]{5,})(?:[/?#]|$)/i.test(u)) return false;
  return /\/trips?(?:\/(?:upcoming|in[_-]?transit|history|active|all|list)?)?(?:[/?#]|$)/i.test(u) ||
    /\/tours?(?:[/?#]|$)/i.test(u);
}

export const SYNC_ALARM = 'relay-sync-flush';
export const ALWAYS_ON_ALARM = 'relay-always-on-tick';
export const SECTION_ALARM_PREFIX = 'relay-section-';

/** Raw entitiesV2 ring buffer. */
export const MAX_RAW_CAPTURES = 20;

export const PAGE_SIZE = 100;
/** ≥2s between any two entitiesV2 requests. */
export const MIN_REQUEST_GAP_MS = 2000;
/** History backfill: 2s between pages. */
export const HISTORY_PAGE_GAP_MS = 2000;
/** Live section considered paused when last successful sync older than this. */
export const LIVE_PAUSE_MS = 5 * 60 * 1000;
/** Catch-up HISTORY pages go back this far before last_successful_sync_at. */
export const CATCH_UP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Schedule minimums (options cannot go below these). */
export const SCHEDULE_MIN = {
  IN_TRANSIT_MS: 45 * 1000,
  UPCOMING_MS: 90 * 1000,
  HISTORY_PAGE1_MS: 10 * 60 * 1000,
};
export const SCHEDULE_DEFAULTS = {
  IN_TRANSIT_MS: 45 * 1000,
  UPCOMING_MS: 90 * 1000,
  HISTORY_PAGE1_MS: 10 * 60 * 1000,
};
export const SCHEDULE_JITTER_MS = 10 * 1000;

export const SYNC_LOCK_HEARTBEAT_MS = 30 * 1000;
export const SYNC_LOCK_STALE_MS = 2 * 60 * 1000;

export const HTTP_BACKOFF_BASE_MS = 2000;
export const HTTP_BACKOFF_MAX_MS = 10 * 60 * 1000;

export const SYNC_FLUSH_MINUTES = 1;
export const FLUSH_TIMEOUT_MS = 90 * 1000;
export const FLUSH_BATCH_SIZE = 20;
export const FLUSH_BACKOFF_BASE_MS = 2000;
export const FLUSH_BACKOFF_MAX_MS = 60000;

export const TYPICAL_FULL_SYNC_SECONDS = 'always-on';
export const HISTORY_SKIP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const RAW_CAPTURES_KEY = 'relayRawCaptures';
export const TRIP_HASH_KEY = 'relayTripHashes';
/** @deprecated — single shared template; use REQUEST_TEMPLATES_KEY */
export const REQUEST_TEMPLATE_KEY = 'relayRequestTemplate';
/** Per-tab entitiesV2 templates: { UPCOMING|IN_TRANSIT|HISTORY: { body, headers, at, source } } */
export const REQUEST_TEMPLATES_KEY = 'relayRequestTemplates';
export const SECTION_SNAPSHOT_KEY = 'relaySectionSnapshots';
export const SECTION_TRIP_IDS_KEY = 'relaySectionTripIds';
export const HISTORY_BACKFILL_KEY = 'relayHistoryBackfill';
export const SYNC_LOCK_KEY = 'relaySyncLock';
/** @deprecated — migrated into REQUEST_TEMPLATE_KEY / REQUEST_TEMPLATES_KEY */
export const LAST_ENTITIES_REQ_KEY = 'relayLastEntitiesRequest';

/** Default timezone for HISTORY / UPCOMING date windows. */
export const RELAY_TIMEZONE = 'Asia/Tashkent';
/** Navigate once to seed IN_TRANSIT template (no built-in fallback). */
export const RELAY_IN_TRANSIT_URL = 'https://relay.amazon.com/tours/in-transit';
