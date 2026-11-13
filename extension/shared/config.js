/** Shared extension config — no service-role keys, no Relay credentials.
 *  Target: Internal system Supabase project iiyqkdjwxlnfqvlidbqr
 *  Paste SUPABASE_ANON_KEY from Dashboard → Project Settings → API (anon/publishable).
 */

export const SUPABASE_URL = 'https://iiyqkdjwxlnfqvlidbqr.supabase.co';

/** Paste anon/publishable key here. Never use service_role. */
export const SUPABASE_ANON_KEY = '';

export const RELAY_SYNC_FN = `${SUPABASE_URL}/functions/v1/relay-sync`;
export const RELAY_TELEGRAM_FN = `${SUPABASE_URL}/functions/v1/relay-telegram`;

/** Extension popup gate only — not Amazon Relay credentials. */
export const EXT_USERNAME = 'admin';
export const EXT_PASSWORD = 'qwerty';

export const SECTIONS = [
  {
    id: 'tours',
    label: 'Tours / My Loads',
    urlHints: ['/tours', '/loads', '/work'],
    required: true,
    collects: 'load_id, amazon_ref_id, status, locations, dates, rates, driver name',
  },
  {
    id: 'load_detail',
    label: 'Load detail',
    urlHints: ['/tour/', '/load/', '/loads/'],
    required: false,
    collects: 'trailer, miles, additional charges, detailed status',
  },
  {
    id: 'payments',
    label: 'Payment information',
    urlHints: ['/payment', '/settlement', '/invoice'],
    required: true,
    collects: 'payment_status, payment_date, settlement amounts',
  },
];

export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
export const TAB_SCAN_ALARM = 'relay-tab-scan';
export const SYNC_ALARM = 'relay-sync-flush';
