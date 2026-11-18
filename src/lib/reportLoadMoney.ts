/**
 * Money math for Drivers / Gross Board / Reports — all from report_loads.
 * Do not use getLoadFinalGross / loads.rate_gross for these pages.
 *
 * Week income = COMPLETED or TONU only (money_bucket=income).
 * Expected = in-transit/upcoming/planned (money_bucket=expected).
 * Pending invoice = completed/TONU not yet on MAIN (money_bucket=pending_invoice).
 * MAIN invoice week wins; adjustment invoices do not move trips.
 */
import type { Driver, GrossAdjustment } from '@/types';
import { getDriverFullName, roundMoney } from '@/lib/utils';
import { inAmazonWeek } from '@/lib/amazonWeek';
import type { InvoiceRow, InvoiceTripRow } from '@/lib/invoiceMoney';
import { excludeFixtureInvoices, normalizeTourId } from '@/lib/invoiceMoney';

export type MoneyBucket = 'income' | 'expected' | 'pending_invoice';

export interface ReportLoadRow {
  tripUuid: string;
  tripId: string;
  tourId: string;
  tripDisplay: string;
  loadIds: string;
  legCount: number;
  broker: string;
  driverName: string;
  driverNameRaw: string | null;
  pickupDate: string | null;
  deliveryDate: string | null;
  puLocation: string;
  delLocation: string;
  tourStartTs: string | null;
  tourStartLa: string | null;
  weekStart: string | null;
  weekEnd: string | null;
  amazonWeek: number | null;
  amazonWeekYear: number | null;
  weekLabel: string;
  /** True when week comes from pickup-date estimate (not MAIN invoice). */
  estimatedWeek: boolean;
  /** 'invoice_main' | 'pickup_estimate' */
  weekSource: 'invoice_main' | 'pickup_estimate' | string;
  invoiceId: string | null;
  /** Paid / Pending from MAIN invoice when week_source=invoice_main. */
  paidStatus: string;
  mile: string;
  amazonPaid: number;
  driverPaid: number;
  rpm: number;
  comment: string;
  dispatch: string;
  section: string | null;
  status: string | null;
  executionStatus: string | null;
  lastSeenAt: string | null;
  updatedAt: string | null;
  /** True only when load_overrides.source = 'manual'. */
  hasOverride: boolean;
  overrideSource: string;
  /** CANCELLED with payout or explicit TONU marker. */
  isTonu: boolean;
  /** income | expected | pending_invoice */
  moneyBucket: MoneyBucket | string;
}

export interface LoadOverrideRow {
  tourId: string;
  driverName: string | null;
  driverPaid: number | null;
  comment: string | null;
  dispatch: string | null;
  mile: string | null;
  broker: string | null;
  source: string;
  legacyReportIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function mapReportLoad(row: Record<string, unknown>): ReportLoadRow {
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const str = (v: unknown) => (v == null ? '' : String(v));
  const strOrNull = (v: unknown) => (v == null || v === '' ? null : String(v));
  return {
    tripUuid: str(row.trip_uuid),
    tripId: str(row.trip_id),
    tourId: str(row.tour_id),
    tripDisplay: str(row.trip_display),
    loadIds: str(row.load_ids),
    legCount: num(row.leg_count),
    broker: str(row.broker) || 'Amazon',
    driverName: str(row.driver_name),
    driverNameRaw: strOrNull(row.driver_name_raw),
    pickupDate: strOrNull(row.pickup_date),
    deliveryDate: strOrNull(row.delivery_date),
    puLocation: str(row.pu_location),
    delLocation: str(row.del_location),
    tourStartTs: strOrNull(row.tour_start_ts),
    tourStartLa: strOrNull(row.tour_start_la),
    weekStart: strOrNull(row.week_start),
    weekEnd: strOrNull(row.week_end),
    amazonWeek: row.amazon_week == null ? null : num(row.amazon_week),
    amazonWeekYear: row.amazon_week_year == null ? null : num(row.amazon_week_year),
    weekLabel: str(row.week_label),
    estimatedWeek: row.estimated_week == null ? true : Boolean(row.estimated_week),
    weekSource: str(row.week_source) || 'pickup_estimate',
    invoiceId: strOrNull(row.invoice_id),
    paidStatus: str(row.paid_status),
    mile: str(row.mile),
    amazonPaid: num(row.amazon_paid),
    driverPaid: num(row.driver_paid),
    rpm: num(row.rpm),
    comment: str(row.comment),
    dispatch: str(row.dispatch),
    section: strOrNull(row.section),
    status: strOrNull(row.status),
    executionStatus: strOrNull(row.execution_status),
    lastSeenAt: strOrNull(row.last_seen_at),
    updatedAt: strOrNull(row.updated_at),
    hasOverride: Boolean(row.has_override),
    overrideSource: str(row.override_source),
    isTonu: Boolean(row.is_tonu),
    moneyBucket: (str(row.money_bucket) || deriveMoneyBucketFallback(row)) as MoneyBucket,
  };
}

/** Client fallback if view columns not yet migrated. */
function deriveMoneyBucketFallback(row: Record<string, unknown>): MoneyBucket {
  const status = String(row.status || '').toUpperCase();
  const exec = String(row.execution_status || '').toUpperCase();
  const mile = String(row.mile || '').toUpperCase();
  const paid = Number(row.amazon_paid) || 0;
  const isTonu =
    status.includes('TONU') ||
    exec.includes('TONU') ||
    mile.includes('TONU') ||
    (status === 'CANCELLED' && paid > 0);
  const isIncome = status === 'COMPLETED' || isTonu;
  if (!isIncome) return 'expected';
  const weekSource = String(row.week_source || '');
  return weekSource === 'invoice_main' ? 'income' : 'pending_invoice';
}

export function isIncomeStatus(row: ReportLoadRow): boolean {
  if (row.moneyBucket === 'income' || row.moneyBucket === 'pending_invoice') return true;
  if (row.isTonu) return true;
  const status = (row.status || '').toUpperCase();
  return status === 'COMPLETED' || status.includes('TONU');
}

export function isWeekIncomeRow(row: ReportLoadRow): boolean {
  return row.moneyBucket === 'income' || (isIncomeStatus(row) && row.weekSource === 'invoice_main');
}

export function isExpectedRow(row: ReportLoadRow): boolean {
  return row.moneyBucket === 'expected' || (!isIncomeStatus(row) && row.moneyBucket !== 'pending_invoice');
}

export function isPendingInvoiceRow(row: ReportLoadRow): boolean {
  return (
    row.moneyBucket === 'pending_invoice' ||
    (isIncomeStatus(row) && row.weekSource === 'pickup_estimate')
  );
}

/** Week income rows for Amazon-compare totals (MAIN completed/TONU). */
export function filterWeekIncome(rows: ReportLoadRow[]): ReportLoadRow[] {
  return rows.filter(isWeekIncomeRow);
}

export function filterWeekExpected(rows: ReportLoadRow[]): ReportLoadRow[] {
  return rows.filter(isExpectedRow);
}

export function filterWeekPendingInvoice(rows: ReportLoadRow[]): ReportLoadRow[] {
  return rows.filter(isPendingInvoiceRow);
}

/** Non-MAIN invoices for a week (adjustment lines). */
export function adjustmentInvoicesForWeek(
  invoices: InvoiceRow[],
  weekStart: string,
  _weekEnd?: string,
): InvoiceRow[] {
  const real = excludeFixtureInvoices(invoices).filter((i) =>
    /^AZNG[0-9A-F]/i.test(i.invoiceId),
  );
  const inWeek = real.filter((i) => i.weekStart === weekStart);
  if (!inWeek.length) return [];
  const mainId = [...inWeek].sort(
    (a, b) => b.amount - a.amount || a.invoiceId.localeCompare(b.invoiceId),
  )[0]?.invoiceId;
  return inWeek.filter((i) => i.invoiceId !== mainId);
}

export function sumAdjustmentInvoices(invoices: InvoiceRow[]): number {
  return roundMoney(invoices.reduce((s, i) => s + i.amount, 0));
}

/**
 * Amazon-compare week total = MAIN income trips + adjustment invoice amounts
 * only when those adj lines are not already covered by this week's income tours
 * (adj must not move trips; W46 $34.07 for a W45 MAIN tour is additive).
 */
export function sumWeekIncomeReconciled(
  weekRows: ReportLoadRow[],
  invoices: InvoiceRow[],
  weekStart: string,
  weekEnd: string,
  invoiceTrips: InvoiceTripRow[] = [],
): { income: number; adjustments: number; pending: number; expected: number; total: number } {
  const incomeRows = filterWeekIncome(weekRows);
  const income = sumAmazonPaid(incomeRows);
  const pending = sumAmazonPaid(filterWeekPendingInvoice(weekRows));
  const expected = sumAmazonPaid(filterWeekExpected(weekRows));
  const incomeTours = new Set(incomeRows.map((r) => normalizeTourId(r.tourId)));
  const adjInvs = adjustmentInvoicesForWeek(invoices, weekStart, weekEnd);
  let adjustments = 0;
  for (const inv of adjInvs) {
    const members = invoiceTrips.filter((t) => t.invoiceId === inv.invoiceId);
    const memberTours = members
      .map((m) => normalizeTourId(m.tourId || m.loadId || ''))
      .filter(Boolean);
    // Additive only when no member is already in this week's MAIN income
    // (e.g. W46 $34.07 for a tour that stays on W45 MAIN). If any member is
    // already counted, the adj is a settlement correction — show the line, don't add $.
    const anyAlreadyInIncome = memberTours.some((t) => incomeTours.has(t));
    if (!anyAlreadyInIncome) adjustments += inv.amount;
  }
  adjustments = roundMoney(adjustments);
  return {
    income,
    adjustments,
    pending,
    expected,
    total: roundMoney(income + adjustments),
  };
}

export function mapLoadOverride(row: Record<string, unknown>): LoadOverrideRow {
  const numOrNull = (v: unknown) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const strOrNull = (v: unknown) => (v == null || v === '' ? null : String(v));
  return {
    tourId: String(row.tour_id || ''),
    driverName: strOrNull(row.driver_name),
    driverPaid: numOrNull(row.driver_paid),
    comment: strOrNull(row.comment),
    dispatch: strOrNull(row.dispatch),
    mile: strOrNull(row.mile),
    broker: strOrNull(row.broker),
    source: String(row.source || 'migrated'),
    legacyReportIds: Array.isArray(row.legacy_report_ids)
      ? (row.legacy_report_ids as string[])
      : [],
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

/** Normalize driver names for matching report_loads → drivers. */
export function normalizePersonName(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function matchDriverToName(drivers: Driver[], name: string): Driver | null {
  if (!name) return null;
  const n = normalizePersonName(name);
  if (!n || /^spot/i.test(n) || /starts/i.test(n)) return null;
  return (
    drivers.find((d) => normalizePersonName(getDriverFullName(d.firstName, d.lastName)) === n) ||
    drivers.find((d) => {
      const full = normalizePersonName(getDriverFullName(d.firstName, d.lastName));
      return full.includes(n) || n.includes(full);
    }) ||
    null
  );
}

export function filterReportLoadsByWeek(
  rows: ReportLoadRow[],
  weekStart: string,
  weekEnd: string,
): ReportLoadRow[] {
  // Prefer assigned week_start (MAIN invoice week, else pickup estimate).
  // Fall back to tour_start_la for rows missing week_start.
  return rows.filter((r) => {
    const key = r.weekStart || r.tourStartLa;
    return inAmazonWeek(key, weekStart, weekEnd);
  });
}

export function sumAmazonPaid(rows: ReportLoadRow[]): number {
  return roundMoney(rows.reduce((s, r) => s + r.amazonPaid, 0));
}

export function sumDriverPaid(rows: ReportLoadRow[]): number {
  return roundMoney(rows.reduce((s, r) => s + r.driverPaid, 0));
}

export function reportLoadsForDriver(
  rows: ReportLoadRow[],
  drivers: Driver[],
  driverId: string,
  weekStart?: string,
  weekEnd?: string,
): ReportLoadRow[] {
  const driver = drivers.find((d) => d.id === driverId);
  if (!driver) return [];
  const full = normalizePersonName(getDriverFullName(driver.firstName, driver.lastName));
  return rows.filter((r) => {
    // Prefer assigned week (MAIN invoice week, else pickup estimate) — not raw pickup alone.
    if (weekStart && weekEnd) {
      const key = r.weekStart || r.tourStartLa;
      if (!inAmazonWeek(key, weekStart, weekEnd)) return false;
    }
    const matched = matchDriverToName(drivers, r.driverName);
    if (matched) return matched.id === driverId;
    // fallback: raw name equals
    return normalizePersonName(r.driverName) === full;
  });
}

export function getDriverAmazonGross(
  rows: ReportLoadRow[],
  drivers: Driver[],
  driverId: string,
  weekStart?: string,
  weekEnd?: string,
  adjustments: GrossAdjustment[] = [],
): number {
  const list = filterWeekIncome(reportLoadsForDriver(rows, drivers, driverId, weekStart, weekEnd));
  const gross = sumAmazonPaid(list);
  const adj = adjustments
    .filter(
      (a) =>
        a.driverId === driverId &&
        (!weekStart || !weekEnd || (a.date >= weekStart && a.date <= weekEnd)),
    )
    .reduce((s, a) => s + a.amount, 0);
  return roundMoney(gross + adj);
}

export function getFleetAmazonGross(
  rows: ReportLoadRow[],
  weekStart?: string,
  weekEnd?: string,
): number {
  const list =
    weekStart && weekEnd ? filterReportLoadsByWeek(rows, weekStart, weekEnd) : rows;
  return sumAmazonPaid(filterWeekIncome(list));
}

/** Mon=0 … Sun=6 daily buckets using tour_start_la (Amazon week Sun–Sat still). */
export function getDailyAmazonByWeekday(
  rows: ReportLoadRow[],
  drivers: Driver[],
  driverId: string,
  weekStart: string,
  weekEnd: string,
): number[] {
  const daily = [0, 0, 0, 0, 0, 0, 0];
  const list = filterWeekIncome(reportLoadsForDriver(rows, drivers, driverId, weekStart, weekEnd));
  for (const r of list) {
    const dayKey = r.tourStartLa || r.pickupDate;
    if (!dayKey) continue;
    const asLocal = parseISONoon(dayKey);
    const day = asLocal.getDay(); // 0=Sun
    const idx = day === 0 ? 6 : day - 1; // Mon=0 … Sun=6 board columns
    daily[idx] += r.amazonPaid;
  }
  return daily.map(roundMoney);
}

function parseISONoon(ymd: string): Date {
  return new Date(`${ymd}T12:00:00`);
}

export type ReportSortKey =
  | 'week'
  | 'pickup'
  | 'delivery'
  | 'trip'
  | 'load'
  | 'driver'
  | 'amazon'
  | 'driverPaid'
  | 'mile'
  | 'dispatch';

/** Newest first by default: week_start desc, pickup desc. */
export function sortReportLoads(
  rows: ReportLoadRow[],
  key: ReportSortKey = 'week',
  dir: 'asc' | 'desc' = 'desc',
): ReportLoadRow[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const cmp = (av: string | number, bv: string | number) => {
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return 0;
    };
    let primary = 0;
    switch (key) {
      case 'week':
        primary = cmp(a.weekStart || '', b.weekStart || '');
        if (primary === 0) primary = cmp(a.pickupDate || a.tourStartLa || '', b.pickupDate || b.tourStartLa || '');
        break;
      case 'pickup':
        primary = cmp(a.pickupDate || a.tourStartLa || '', b.pickupDate || b.tourStartLa || '');
        break;
      case 'delivery':
        primary = cmp(a.deliveryDate || '', b.deliveryDate || '');
        break;
      case 'trip':
        primary = cmp(a.tripDisplay, b.tripDisplay);
        break;
      case 'load':
        primary = cmp(a.loadIds, b.loadIds);
        break;
      case 'driver':
        primary = cmp(a.driverName, b.driverName);
        break;
      case 'amazon':
        primary = cmp(a.amazonPaid, b.amazonPaid);
        break;
      case 'driverPaid':
        primary = cmp(a.driverPaid, b.driverPaid);
        break;
      case 'mile':
        primary = cmp(a.mile, b.mile);
        break;
      case 'dispatch':
        primary = cmp(a.dispatch, b.dispatch);
        break;
      default:
        primary = 0;
    }
    if (primary !== 0) return primary;
    // Stable newest-first tiebreak
    const tie = (b.pickupDate || b.tourStartLa || '').localeCompare(a.pickupDate || a.tourStartLa || '');
    if (tie !== 0) return tie;
    return a.tourId.localeCompare(b.tourId);
  });
}

export function groupReportLoadsByWeekLabel(
  rows: ReportLoadRow[],
  sortKey: ReportSortKey = 'week',
  sortDir: 'asc' | 'desc' = 'desc',
): { week: string; rows: ReportLoadRow[] }[] {
  const sorted = sortReportLoads(rows, sortKey, sortDir);
  const groups: { week: string; rows: ReportLoadRow[] }[] = [];
  for (const row of sorted) {
    const week = row.weekLabel || 'Week??';
    const last = groups[groups.length - 1];
    if (last && last.week.toLowerCase() === week.toLowerCase()) last.rows.push(row);
    else groups.push({ week, rows: [row] });
  }
  // When sorting by week desc, groups should appear newest-first
  if (sortKey === 'week' && sortDir === 'desc') {
    return groups.sort((a, b) => {
      const aw = a.rows[0]?.weekStart || '';
      const bw = b.rows[0]?.weekStart || '';
      return bw.localeCompare(aw);
    });
  }
  return groups;
}
