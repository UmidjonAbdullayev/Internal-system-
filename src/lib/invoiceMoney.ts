/**
 * Amazon Relay invoice helpers — week grouping, paid status, reconciliation.
 */
import { roundMoney } from '@/lib/utils';

/** Real Relay settlement IDs: AZNG + 32 hex, no dashes. */
export const REAL_AZNG_INVOICE_ID = /^AZNG[0-9A-F]{32}$/;

/** True for FIXTURE-*, AZNG-SMOKE-*, dashed ids, or anything not real AZNG. */
export function isFixtureInvoiceId(id: string | null | undefined): boolean {
  const s = String(id || '');
  if (!s) return true;
  return !REAL_AZNG_INVOICE_ID.test(s);
}

export function isRealAzngInvoiceId(id: string | null | undefined): boolean {
  return REAL_AZNG_INVOICE_ID.test(String(id || ''));
}

export function excludeFixtureInvoices<T extends { invoiceId: string }>(rows: T[]): T[] {
  return rows.filter((r) => isRealAzngInvoiceId(r.invoiceId));
}

export interface InvoiceRow {
  invoiceId: string;
  amazonWeekYear: number;
  amazonWeek: number;
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  workType: string | null;
  amount: number;
  status: string;
  paymentStatusRaw: string | null;
  invoiceDate: string | null;
  expectedPaymentDate: string | null;
  paidAt: string | null;
  invoiceStatus: string | null;
  creditNote: string | null;
  tourIds: string[];
  loadIds: string[];
  lastSyncedAt: string | null;
}

export interface InvoiceTripRow {
  invoiceId: string;
  amazonWeekYear: number;
  amazonWeek: number;
  weekLabel: string;
  tourId: string | null;
  loadId: string | null;
}

export interface PaymentsSummaryRow {
  yearToDatePaymentAmt: number | null;
  pendingInvoicePaymentAmt: number | null;
  expectedPaymentDate: string | null;
  timeZone: string | null;
  lastSyncedAt: string | null;
}

export interface WeekInvoiceGroup {
  key: string;
  year: number;
  week: number;
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  invoices: InvoiceRow[];
  total: number;
  status: 'Paid' | 'Pending' | 'Mixed' | string;
  expectedOrPaidDate: string | null;
  tripCount: number;
  loadCount: number;
}

export function mapInvoice(row: Record<string, unknown>): InvoiceRow {
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const strOrNull = (v: unknown) => (v == null || v === '' ? null : String(v));
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
  return {
    invoiceId: String(row.invoice_id || ''),
    amazonWeekYear: num(row.amazon_week_year),
    amazonWeek: num(row.amazon_week),
    weekLabel: String(row.week_label || ''),
    weekStart: String(row.week_start || ''),
    weekEnd: String(row.week_end || ''),
    workType: strOrNull(row.work_type),
    amount: num(row.amount),
    status: String(row.status || ''),
    paymentStatusRaw: strOrNull(row.payment_status_raw),
    invoiceDate: strOrNull(row.invoice_date),
    expectedPaymentDate: strOrNull(row.expected_payment_date),
    paidAt: strOrNull(row.paid_at),
    invoiceStatus: strOrNull(row.invoice_status),
    creditNote: strOrNull(row.credit_note),
    tourIds: arr(row.tour_ids),
    loadIds: arr(row.load_ids),
    lastSyncedAt: strOrNull(row.last_synced_at),
  };
}

export function mapInvoiceTrip(row: Record<string, unknown>): InvoiceTripRow {
  return {
    invoiceId: String(row.invoice_id || ''),
    amazonWeekYear: Number(row.amazon_week_year) || 0,
    amazonWeek: Number(row.amazon_week) || 0,
    weekLabel: String(row.week_label || ''),
    tourId: row.tour_id == null || row.tour_id === '' ? null : String(row.tour_id),
    loadId: row.load_id == null || row.load_id === '' ? null : String(row.load_id),
  };
}

export function mapPaymentsSummary(row: Record<string, unknown>): PaymentsSummaryRow {
  const numOrNull = (v: unknown) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const strOrNull = (v: unknown) => (v == null || v === '' ? null : String(v));
  return {
    yearToDatePaymentAmt: numOrNull(row.year_to_date_payment_amt),
    pendingInvoicePaymentAmt: numOrNull(row.pending_invoice_payment_amt),
    expectedPaymentDate: strOrNull(row.expected_payment_date),
    timeZone: strOrNull(row.time_zone),
    lastSyncedAt: strOrNull(row.last_synced_at),
  };
}

export function normalizeTourId(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/^T-/i, '')
    .toUpperCase();
}

export function groupInvoicesByWeek(invoices: InvoiceRow[]): WeekInvoiceGroup[] {
  const map = new Map<string, InvoiceRow[]>();
  for (const inv of excludeFixtureInvoices(invoices)) {
    const key = `${inv.amazonWeekYear}#${inv.amazonWeek}`;
    const list = map.get(key) || [];
    list.push(inv);
    map.set(key, list);
  }
  const groups: WeekInvoiceGroup[] = [];
  for (const [key, list] of map) {
    const sorted = [...list].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const statuses = new Set(sorted.map((i) => i.status));
    let status: WeekInvoiceGroup['status'] = sorted[0]?.status || 'Unknown';
    if (statuses.size > 1) status = 'Mixed';
    else if (statuses.has('Paid')) status = 'Paid';
    else if (statuses.has('Pending')) status = 'Pending';

    const tourSet = new Set<string>();
    const loadSet = new Set<string>();
    for (const inv of sorted) {
      for (const t of inv.tourIds) tourSet.add(normalizeTourId(t));
      for (const l of inv.loadIds) loadSet.add(l.toUpperCase());
    }

    const expectedOrPaidDate =
      sorted.find((i) => i.paidAt)?.paidAt?.slice(0, 10) ||
      sorted.find((i) => i.expectedPaymentDate)?.expectedPaymentDate ||
      null;

    groups.push({
      key,
      year: sorted[0].amazonWeekYear,
      week: sorted[0].amazonWeek,
      weekLabel: sorted[0].weekLabel || `Week${sorted[0].amazonWeek}`,
      weekStart: sorted[0].weekStart,
      weekEnd: sorted[0].weekEnd,
      invoices: sorted,
      total: roundMoney(sorted.reduce((s, i) => s + i.amount, 0)),
      status,
      expectedOrPaidDate,
      tripCount: tourSet.size,
      loadCount: loadSet.size,
    });
  }
  return groups.sort((a, b) =>
    b.year !== a.year ? b.year - a.year : b.week - a.week,
  );
}

/** Paid / Pending / Not invoiced yet for a tour or load id. */
export function invoicePaidStatusForTour(
  tourId: string,
  loadIds: string[],
  invoices: InvoiceRow[],
  invoiceTrips: InvoiceTripRow[],
): { paidStatus: 'Paid' | 'Pending' | 'Not invoiced yet'; invoiceWeek: string | null } {
  const bare = normalizeTourId(tourId);
  const loads = new Set(loadIds.map((l) => l.toUpperCase()).filter(Boolean));
  const realInvoices = excludeFixtureInvoices(invoices);
  const realTrips = excludeFixtureInvoices(invoiceTrips);
  const invIds = new Set<string>();
  for (const it of realTrips) {
    if (it.tourId && normalizeTourId(it.tourId) === bare) invIds.add(it.invoiceId);
    if (it.loadId && loads.has(it.loadId.toUpperCase())) invIds.add(it.invoiceId);
  }
  // Also match invoice arrays directly
  for (const inv of realInvoices) {
    if (inv.tourIds.some((t) => normalizeTourId(t) === bare)) invIds.add(inv.invoiceId);
    if (inv.loadIds.some((l) => loads.has(l.toUpperCase()))) invIds.add(inv.invoiceId);
  }
  if (!invIds.size) return { paidStatus: 'Not invoiced yet', invoiceWeek: null };

  const matched = realInvoices.filter((i) => invIds.has(i.invoiceId));
  // Prefer MAIN invoice week (largest amount among matched)
  const main = [...matched].sort((a, b) => b.amount - a.amount)[0];
  const statuses = new Set(matched.map((m) => m.status));
  let paidStatus: 'Paid' | 'Pending' | 'Not invoiced yet' = 'Pending';
  if (statuses.has('Pending') && statuses.has('Paid')) {
    // Any pending → Pending until all paid? Spec: Paid / Pending / Not invoiced
    paidStatus = 'Pending';
  } else if (statuses.has('Paid') && !statuses.has('Pending')) {
    paidStatus = 'Paid';
  } else if (statuses.has('Pending')) {
    paidStatus = 'Pending';
  } else if (matched.some((m) => /paid/i.test(m.status))) {
    paidStatus = 'Paid';
  }
  return {
    paidStatus,
    invoiceWeek: main?.weekLabel || null,
  };
}
