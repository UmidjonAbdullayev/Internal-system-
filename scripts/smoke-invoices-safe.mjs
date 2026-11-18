#!/usr/bin/env node
/**
 * Safe invoice acceptance check — NEVER writes to production.
 *
 * Use either:
 *   1) ALLOW_TEST_DB=1 + SUPABASE_URL pointing at a dedicated test project, or
 *   2) --dry-run (default) — validate payload shape only, no network writes.
 *
 * Rolled-back txn smoke against prod is not supported from this script (PostgREST
 * has no multi-statement txn). Do not POST AZNG-SMOKE-* / FIXTURE-* to live.
 *
 * Usage:
 *   node scripts/smoke-invoices-safe.mjs
 *   node scripts/smoke-invoices-safe.mjs --dry-run
 *   ALLOW_TEST_DB=1 SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/smoke-invoices-safe.mjs --write-test-db
 */

const REAL_AZNG = /^AZNG[0-9A-F]{32}$/;
const PROD_REF_HINTS = ['iiyqkdjwxlnfqvlidbqr'];

/** Acceptance amounts for local shape checks only — ids are fake and must never hit prod. */
const ACCEPTANCE_SAMPLES = [
  {
    invoice_id: 'AZNG-SMOKE-W46-MAIN',
    amazon_week_year: 2026,
    amazon_week: 46,
    amount: 295626.3,
    note: 'fake — rejected by DB CHECK and relay-sync',
  },
  {
    invoice_id: 'AZNGCC16E7AA4BEA46979BF8022158263132',
    amazon_week_year: 2026,
    amazon_week: 46,
    amount: 295626.3,
    note: 'real MAIN shape',
  },
];

function isProdUrl(url) {
  const u = String(url || '').toLowerCase();
  return PROD_REF_HINTS.some((h) => u.includes(h));
}

function assertNeverWriteFakeToProd(url, rows) {
  const fake = rows.filter((r) => !REAL_AZNG.test(String(r.invoice_id || '')));
  if (fake.length && isProdUrl(url)) {
    throw new Error(
      `Refusing to write ${fake.length} non-real invoice_id(s) to prod URL. ` +
        `Use a separate test DB or dry-run. First fake: ${fake[0].invoice_id}`,
    );
  }
}

function dryRun() {
  const real = ACCEPTANCE_SAMPLES.filter((r) => REAL_AZNG.test(r.invoice_id));
  const fake = ACCEPTANCE_SAMPLES.filter((r) => !REAL_AZNG.test(r.invoice_id));
  const w46RealSum = 295626.3 + 34.07 + 0.01;
  console.log('smoke-invoices-safe: dry-run (no DB writes)');
  console.log(`  real-shaped samples: ${real.length}`);
  console.log(`  fake samples (must never reach prod): ${fake.map((f) => f.invoice_id).join(', ')}`);
  console.log(`  expected live W46 (3 real invoices): $${w46RealSum.toFixed(2)}`);
  console.log('OK — use --write-test-db only against a non-prod project with ALLOW_TEST_DB=1');
}

async function writeTestDb() {
  if (process.env.ALLOW_TEST_DB !== '1') {
    throw new Error('Set ALLOW_TEST_DB=1 to acknowledge a dedicated test database.');
  }
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for --write-test-db');
  }
  if (isProdUrl(url)) {
    throw new Error(`Refusing --write-test-db against prod URL: ${url}`);
  }

  // Only real-shaped rows; still blocked on prod via URL check above.
  const rows = ACCEPTANCE_SAMPLES.filter((r) => REAL_AZNG.test(r.invoice_id)).map((r) => ({
    invoice_id: r.invoice_id,
    amazon_week_year: r.amazon_week_year,
    amazon_week: r.amazon_week,
    week_label: `Week${r.amazon_week}`,
    week_start: '2026-11-08',
    week_end: '2026-11-14',
    amount: r.amount,
    status: 'Pending',
    tour_ids: [],
    load_ids: [],
  }));
  assertNeverWriteFakeToProd(url, rows);

  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/invoices?on_conflict=invoice_id`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Test DB upsert failed ${res.status}: ${text}`);
  }
  console.log(`Wrote ${rows.length} real-shaped row(s) to test DB (not prod).`);
}

const args = new Set(process.argv.slice(2));
try {
  if (args.has('--write-test-db')) {
    await writeTestDb();
  } else {
    dryRun();
  }
} catch (err) {
  console.error(String(err?.message || err));
  process.exit(1);
}
