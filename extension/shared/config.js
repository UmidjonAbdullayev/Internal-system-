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

export const SECTIONS = [
  {
    id: 'tours',
    label: 'Tours / My Loads',
    // Relay SPA: /trips, /trips/upcoming|in-transit|history (board — not detail)
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
    collects:
      'trip/load ids, tractor, trailer, driver, pay, trip_bucket, status_bar, CRM dates/locations',
  },
  {
    id: 'load_detail',
    label: 'Load detail',
    // True detail URLs only (…/trips/T-XXXX). Board paths handled as tours.
    urlHints: ['/tour/t-', '/tours/t-', '/trip/t-', '/trips/t-', '/load/'],
    required: false,
    collects: 'trailer, tractor, miles, additional charges, detailed status',
  },
  {
    id: 'payments',
    label: 'Payment information',
    urlHints: ['/payment', '/settlement', '/invoice'],
    required: true,
    collects: 'payment_status, payment_date, settlement amounts',
  },
];

/** Board vs detail: /trips/in-transit is tours; /trips/T-XXXX is detail. */
export function isTripsBoardUrl(url) {
  const u = String(url || '').toLowerCase();
  if (/\/trips?\/(t-[a-z0-9]+|[0-9]{2,3}[a-z0-9]{5,})(?:[/?#]|$)/i.test(u)) return false;
  return /\/trips?(?:\/(?:upcoming|in[_-]?transit|history|active|all|list)?)?(?:[/?#]|$)/i.test(u);
}

export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
export const TAB_SCAN_ALARM = 'relay-tab-scan';
export const SYNC_ALARM = 'relay-sync-flush';
export const PAYMENTS_SCAN_ALARM = 'relay-payments-scan';

/**
 * Soft / stealth pacing (human-like, non-blocking).
 * Trips scan ~every 4–6 min with jitter; payments ~every 20–30 min.
 * Full Trips+History pass typically takes 45–90s depending on expand count.
 */
export const TRIPS_SCAN_BASE_MINUTES = 4;
export const TRIPS_SCAN_JITTER_MINUTES = 2;
export const PAYMENTS_SCAN_BASE_MINUTES = 20;
export const PAYMENTS_SCAN_JITTER_MINUTES = 10;
export const SYNC_FLUSH_MINUTES = 2;
export const TYPICAL_FULL_SYNC_SECONDS = '45–90';

/** Auto-expand Trips rows for trailer/tractor/stop detail.
 * Active boards need a higher budget so ~15 In Transit rows all get places/driver.
 * History keeps a smaller share so it cannot starve active expands.
 */
/** Safe expand: wait for legs (Trailer/Tractor/Arrival/Sch.) after toggle/chevron. */
export const EXPAND_DELAY_MS = 650;
export const EXPAND_COLLAPSE_DELAY_MS = 220;
export const EXPAND_JITTER_MS = 300;
export const MAX_EXPAND_PER_SCAN = 28;
export const MAX_EXPAND_ACTIVE = 22;
export const MAX_EXPAND_HISTORY = 6;
export const NEAR_LIVE_MAX_EXPAND = 8;
export const DETAIL_SCRAPE_TTL_MS = 6 * 60 * 60 * 1000;
export const TAB_SWITCH_DELAY_MS = 1100;
export const TAB_SWITCH_JITTER_MS = 500;
export const HISTORY_WEEK_SETTLE_MS = 1400;
/** Scroll virtualized Trips lists until row count stabilizes. */
export const LIST_SCROLL_MAX_PASSES = 28;
export const LIST_SCROLL_SETTLE_MS = 380;
export const LIST_SCROLL_STABLE_ROUNDS = 2;

/** Skip re-scraping payments if last collection was within this window (unless force). */
export const PAYMENTS_MIN_INTERVAL_MS = 18 * 60 * 1000;

/**
 * Soft-scan safety: hard timeouts so a hung Payments scrape / Edge flush
 * cannot leave the popup stuck on "busy" and block Trips forever.
 * Flush was timing out at 45s under concurrent 70+ row payloads (expand→sync).
 */
export const SOFT_SCAN_HARD_TIMEOUT_MS = 180 * 1000;
export const COLLECT_TAB_TIMEOUT_MS = 120 * 1000;
export const FLUSH_TIMEOUT_MS = 90 * 1000;
export const FLUSH_BATCH_SIZE = 20;
export const PAYMENTS_COLLECT_TIMEOUT_MS = 60 * 1000;

/**
 * Near-live Trips (Upcoming + In Transit only): MutationObserver / network
 * hooks debounce into an incremental sync. History + Payments stay on soft cadence.
 */
export const NEAR_LIVE_DEBOUNCE_MS = 2800;
export const NEAR_LIVE_DEBOUNCE_JITTER_MS = 1800;
export const NEAR_LIVE_MIN_INTERVAL_MS = 8 * 1000;
export const NEAR_LIVE_FLUSH_DEBOUNCE_MS = 1500;

/** History skip: keep local cache entries this long before forcing a refresh expand. */
export const HISTORY_SKIP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
