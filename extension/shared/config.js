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
