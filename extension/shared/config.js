/** Shared extension config — no service-role keys, no Relay credentials. */

export const SUPABASE_URL = 'https://abymkczeobyfnplqwbrk.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFieW1rY3plb2J5Zm5wbHF3YnJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NTI2NDcsImV4cCI6MjA5MzEyODY0N30.nxgZVxC4eQkpehIJTfG45a3523cbz_LUFkwv2jtFu24';

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
