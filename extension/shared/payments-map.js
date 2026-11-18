/**
 * Map Relay financials settlements / payments-summary → CRM invoice rows.
 */

/** Week 1 = Sun–Sat containing Jan 1 (America/Los_Angeles calendar intent). */
export function amazonWeekBounds(year, week) {
  const y = Number(year);
  const w = Number(week);
  if (!Number.isFinite(y) || !Number.isFinite(w) || w < 1) return null;
  // Use UTC noon to avoid DST edge when only caring about calendar dates
  const jan1 = new Date(Date.UTC(y, 0, 1, 12, 0, 0));
  const dow = jan1.getUTCDay(); // 0=Sun
  const week1Sun = new Date(jan1);
  week1Sun.setUTCDate(jan1.getUTCDate() - dow);
  const start = new Date(week1Sun);
  start.setUTCDate(week1Sun.getUTCDate() + (w - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { weekStart: iso(start), weekEnd: iso(end) };
}

export function parseContextId(contextId) {
  const m = String(contextId || '').trim().match(/^(\d{4})#(\d{1,2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const bounds = amazonWeekBounds(year, week);
  if (!bounds) return null;
  return {
    year,
    week,
    weekLabel: `Week${week}`,
    weekStart: bounds.weekStart,
    weekEnd: bounds.weekEnd,
  };
}

export function mapPaymentStatus(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'PENDING') return 'Pending';
  if (s === 'INITIATED') return 'Paid';
  return raw == null || raw === '' ? 'Unknown' : String(raw);
}

export function splitIds(raw) {
  if (raw == null) return [];
  const parts = String(raw)
    .split(', ')
    .map((x) => x.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const key = p.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function roundMoney2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function toDateOnly(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function toTimestamptz(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v));
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

/**
 * @param {object} item — settlementList element
 * @returns {object|null} invoice row for relay-sync
 */
export function mapSettlementToInvoice(item) {
  if (!item || typeof item !== 'object') return null;
  const invoiceId = String(item.id || '').trim();
  // Real Relay settlement IDs only — never map FIXTURE/SMOKE/dashed test ids
  if (!invoiceId || !/^AZNG[0-9A-F]{32}$/.test(invoiceId)) return null;

  const meta = item.settlementsMetadata || item.settlementMetadata || {};
  const ctx = parseContextId(meta.contextId);
  if (!ctx) return null;

  const amount = roundMoney2(item.totalAmount?.value ?? item.totalAmount);
  if (amount == null) return null;

  const tourIds = splitIds(meta.tourIds);
  const loadIds = splitIds(meta.vrIds);

  return {
    invoice_id: invoiceId,
    amazon_week_year: ctx.year,
    amazon_week: ctx.week,
    week_label: ctx.weekLabel,
    week_start: ctx.weekStart,
    week_end: ctx.weekEnd,
    work_type: meta.workType != null ? String(meta.workType) : null,
    amount,
    status: mapPaymentStatus(item.paymentStatus),
    payment_status_raw: item.paymentStatus != null ? String(item.paymentStatus) : null,
    invoice_date: toDateOnly(item.invoiceDate),
    expected_payment_date: toDateOnly(item.expectedPaymentDate),
    paid_at: toTimestamptz(item.paymentInitiationDate),
    invoice_status: item.invoiceStatus != null ? String(item.invoiceStatus) : null,
    credit_note: item.creditNote != null ? String(item.creditNote) : null,
    tour_ids: tourIds,
    load_ids: loadIds,
  };
}

export function mapSettlementList(settlementList) {
  const invoices = [];
  for (const item of settlementList || []) {
    const row = mapSettlementToInvoice(item);
    if (row) invoices.push(row);
  }
  return invoices;
}

export function mapPaymentsSummary(data) {
  if (!data || typeof data !== 'object') return null;
  const ytd = roundMoney2(data.yearToDatePaymentAmt?.value ?? data.yearToDatePaymentAmt);
  const pending = roundMoney2(
    data.pendingInvoicePaymentAmt?.value ?? data.pendingInvoicePaymentAmt,
  );
  return {
    year_to_date_payment_amt: ytd,
    pending_invoice_payment_amt: pending,
    expected_payment_date: toDateOnly(data.expectedPaymentDate),
    time_zone: data.timeZone != null ? String(data.timeZone) : null,
  };
}

/** Acceptance helpers */
export function sumWeekAmount(invoices, year, week) {
  return roundMoney2(
    (invoices || [])
      .filter((i) => i.amazon_week_year === year && i.amazon_week === week)
      .reduce((s, i) => s + Number(i.amount || 0), 0),
  );
}
