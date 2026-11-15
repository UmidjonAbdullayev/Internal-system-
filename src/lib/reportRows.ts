import { format, getISOWeek, getISOWeekYear, parseISO } from 'date-fns';
import type { Driver, Load, LoadReport } from '@/types';
import { getLoadFinalGross } from '@/lib/calculations';
import { getDriverFullName, roundMoney } from '@/lib/utils';

/** Sheet-style date: DD.MM.YYYY */
export function formatSheetDate(date: string | null | undefined): string {
  if (!date) return '';
  try {
    return format(parseISO(date), 'dd.MM.yyyy');
  } catch {
    return '';
  }
}

/** Week label like Week45 from a yyyy-MM-dd date (ISO week). */
export function weekLabelFromDate(date: string | null | undefined): string {
  if (!date) return '';
  try {
    const d = parseISO(date);
    const week = getISOWeek(d);
    return `Week${String(week).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export function computeRpm(amazonPaid: number, mile: string): number {
  const miles = parseMileNumber(mile);
  if (!miles || miles <= 0) return 0;
  return roundMoney(amazonPaid / miles);
}

/**
 * Sheet columns "PU Date" / "Del date" are city/state places — never miles, $, RPM, or Unknown.
 */
export function sanitizeReportLocation(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (/^unknown\b/i.test(s)) return '';
  if (/^\$/.test(s) || /\$\s*[\d,]/.test(s)) return '';
  if (/^\d[\d,]*\.?\d*\s*(mi|miles)?\s*$/i.test(s)) return '';
  if (/^\/?Live$/i.test(s)) return '';
  if (/^[,.]/.test(s) || /^[a-z]/.test(s)) return ''; // truncated scrap from Relay ellipsis
  if (/^(Drop|Pickup|PU|Del|Spot|Vendor)$/i.test(s)) return '';
  if (s.length < 3) return '';
  return s.slice(0, 120);
}

export function isBadReportLocation(raw: string | null | undefined): boolean {
  return !sanitizeReportLocation(raw);
}

export function parseMileNumber(mile: string): number | null {
  if (!mile || mile.trim().toUpperCase() === 'TONU') return null;
  const cleaned = mile.replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizeLoadLookupKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/^T-/, '');
}

/** Match synced Relay loads by load id, amazon ref, or trip id. */
export function findLoadsByLookup(loads: Load[], query: string): Load[] {
  const q = query.trim();
  if (!q) return [];
  const key = normalizeLoadLookupKey(q);
  const exact = loads.filter((l) => {
    const candidates = [l.loadId, l.amazonRefId, l.parentTripId ?? '']
      .filter(Boolean)
      .map(normalizeLoadLookupKey);
    return candidates.includes(key) || candidates.includes(normalizeLoadLookupKey(`T-${key}`));
  });
  if (exact.length) return exact;
  // Partial: multi-id sheets often use "A/B"
  const parts = q.split(/[/,|\s]+/).map((p) => normalizeLoadLookupKey(p)).filter(Boolean);
  if (parts.length <= 1) return [];
  return loads.filter((l) => {
    const candidates = [l.loadId, l.amazonRefId, l.parentTripId ?? '']
      .filter(Boolean)
      .map(normalizeLoadLookupKey);
    return parts.some((p) => candidates.includes(p));
  });
}

export function driverNameForLoad(
  load: Load,
  drivers: Driver[],
): string {
  if (load.driverId) {
    const d = drivers.find((x) => x.id === load.driverId);
    if (d) return getDriverFullName(d.firstName, d.lastName);
  }
  const raw = (load.driverNameRaw || '').replace(/\s+/g, ' ').trim();
  if (!raw || /^spot/i.test(raw) || /starts/i.test(raw)) return '';
  return raw;
}

export function tripForLoad(load: Load): string {
  if (load.parentTripId) return load.parentTripId.startsWith('T-') ? load.parentTripId : `T-${load.parentTripId}`;
  if (load.loadId.startsWith('T-')) return load.loadId;
  if (load.amazonRefId) return `T-${load.amazonRefId}`;
  return '';
}

export function buildReportFromLoad(
  load: Load,
  drivers: Driver[],
  dispatch = '',
  source: LoadReport['source'] = 'sync',
): Omit<LoadReport, 'id' | 'createdAt' | 'updatedAt'> {
  const amazonPaid = getLoadFinalGross(load);
  const mile =
    load.distanceMiles > 0 ? String(Number(load.distanceMiles.toFixed(2))) : '';
  return {
    loadUuid: load.id,
    broker: 'Amazon',
    trip: tripForLoad(load),
    loadIds: load.loadId || load.amazonRefId || '',
    driverName: driverNameForLoad(load, drivers),
    pickupDate: load.pickupDate || null,
    deliveryDate: load.deliveryDate || null,
    // Map place fields only — never mile / rate_gross / RPM into PU/Del columns
    puLocation: sanitizeReportLocation(load.pickupLocation),
    delLocation: sanitizeReportLocation(load.deliveryLocation),
    mile,
    amazonPaid,
    driverPaid: amazonPaid,
    rpm: computeRpm(amazonPaid, mile),
    comment: weekLabelFromDate(load.pickupDate || load.deliveryDate),
    dispatch,
    source,
  };
}

export function reportInDateRange(
  row: Pick<LoadReport, 'pickupDate' | 'deliveryDate'>,
  start: string,
  end: string,
): boolean {
  const pu = row.pickupDate || '';
  const del = row.deliveryDate || '';
  if (pu && pu >= start && pu <= end) return true;
  if (del && del >= start && del <= end) return true;
  return false;
}

export function loadInDateRange(load: Load, start: string, end: string): boolean {
  return reportInDateRange(
    { pickupDate: load.pickupDate, deliveryDate: load.deliveryDate },
    start,
    end,
  );
}

export function sortReportRows(rows: LoadReport[]): LoadReport[] {
  return [...rows].sort((a, b) => {
    const ad = a.pickupDate || a.deliveryDate || '';
    const bd = b.pickupDate || b.deliveryDate || '';
    if (ad !== bd) return ad.localeCompare(bd);
    return (a.loadIds || '').localeCompare(b.loadIds || '');
  });
}

/** Group sorted rows by week comment for sheet-style blue separators. */
export function groupReportsByWeek(rows: LoadReport[]): { week: string; rows: LoadReport[] }[] {
  const groups: { week: string; rows: LoadReport[] }[] = [];
  for (const row of sortReportRows(rows)) {
    const week =
      row.comment?.match(/Week\d+/i)?.[0] ||
      weekLabelFromDate(row.pickupDate || row.deliveryDate) ||
      'Week??';
    const last = groups[groups.length - 1];
    if (last && last.week.toLowerCase() === week.toLowerCase()) {
      last.rows.push(row);
    } else {
      groups.push({ week, rows: [row] });
    }
  }
  return groups;
}

export function isoWeekKey(date: string): string {
  try {
    const d = parseISO(date);
    return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, '0')}`;
  } catch {
    return date;
  }
}
