#!/usr/bin/env node
/**
 * IS-63 money income guard — runs on fixed fixture (no production DB).
 * 1) TONU: cancelled (status or execution_status) + payout > 0 → income on MAIN week
 * 2) W46 fixture trip payouts sum === MAIN invoice total ($295,626.30)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/w46-main-income-snapshot.json'), 'utf8'),
);

function isTonuTrip({ status, executionStatus, mile, payout }) {
  const st = String(status || '').toUpperCase();
  const ex = String(executionStatus || '').toUpperCase();
  const mi = String(mile || '').toUpperCase();
  const paid = Number(payout) || 0;
  return (
    st.includes('TONU') ||
    ex.includes('TONU') ||
    mi.includes('TONU') ||
    (paid > 0 && (st.includes('CANCEL') || ex.includes('CANCEL')))
  );
}

function classifyMoneyBucket({ status, executionStatus, mile, payout, weekSource }) {
  const st = String(status || '').toUpperCase();
  const tonu = isTonuTrip({ status, executionStatus, mile, payout });
  if (!(st === 'COMPLETED' || tonu)) return 'expected';
  return String(weekSource || '') === 'invoice_main' ? 'income' : 'pending_invoice';
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('OK:', msg);
  }
}

// --- TONU cases ---
for (const c of fixture.tonu_cases || []) {
  const tonu = isTonuTrip({
    status: c.status,
    executionStatus: c.execution_status,
    payout: c.payout,
  });
  const bucket = classifyMoneyBucket({
    status: c.status,
    executionStatus: c.execution_status,
    payout: c.payout,
    weekSource: c.week_source,
  });
  assert(tonu === c.expect_tonu, `TONU ${c.name}: got tonu=${tonu} expect=${c.expect_tonu}`);
  assert(
    bucket === c.expect_bucket,
    `bucket ${c.name}: got ${bucket} expect ${c.expect_bucket}`,
  );
}

// Explicit regression: removed_from_relay must still be income when exec cancelled + payout
{
  const bucket = classifyMoneyBucket({
    status: 'removed_from_relay',
    executionStatus: 'CANCELLED',
    payout: 175,
    weekSource: 'invoice_main',
  });
  assert(bucket === 'income', 'removed_from_relay + CANCELLED + payout → income');
}

// --- W46 MAIN snapshot sum ---
const trips = fixture.trips || [];
const sum = round2(trips.reduce((s, t) => s + Number(t.payout || 0), 0));
const mainAmt = round2(fixture.main_invoice_amount);
const verified = round2(fixture.verified_income);
assert(trips.length === 149, `W46 trip count ${trips.length} === 149`);
assert(sum === mainAmt, `W46 Σ payouts ${sum} === MAIN invoice ${mainAmt}`);
assert(sum === verified, `W46 Σ payouts ${sum} === verified ${verified}`);

// Reclassify each fixture trip through classifier — income rows stay income
let reclassSum = 0;
let reclassN = 0;
for (const t of trips) {
  const bucket = classifyMoneyBucket({
    status: t.status,
    executionStatus: t.execution_status,
    payout: t.payout,
    weekSource: t.week_source || 'invoice_main',
  });
  if (bucket === 'income') {
    reclassSum += Number(t.payout) || 0;
    reclassN += 1;
  }
}
reclassSum = round2(reclassSum);
assert(reclassN === trips.length, `reclassify keeps all ${trips.length} as income (got ${reclassN})`);
assert(reclassSum === verified, `reclassify sum ${reclassSum} === verified`);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\n=== money-income-guard PASSED ===');
