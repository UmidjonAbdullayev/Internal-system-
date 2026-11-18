/**
 * Amazon Relay money weeks: Sunday–Saturday, cut at midnight America/Los_Angeles.
 * Week number = ISO week of the Monday inside that Sun–Sat span
 * (e.g. Nov 8–14 2026 = Week46).
 */
import { addDays, format, getISOWeek, getISOWeekYear, parseISO } from 'date-fns';

export const MONEY_TZ = 'America/Los_Angeles';

/** Calendar yyyy-MM-dd in America/Los_Angeles for an instant (or "now"). */
export function laTodayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MONEY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** LA calendar date of a timestamptz / ISO string. */
export function toLaDateISO(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return laTodayISO(d);
  } catch {
    return null;
  }
}

/** Sunday (inclusive) of the Amazon week containing yyyy-MM-dd (LA calendar). */
export function amazonWeekStart(ymd: string): string {
  // Noon avoids DST edge cases for date-only calendar math.
  const asLocal = parseISO(ymd + 'T12:00:00');
  const day = asLocal.getDay(); // 0=Sun
  return format(addDays(asLocal, -day), 'yyyy-MM-dd');
}

export function amazonWeekEnd(ymd: string): string {
  return format(addDays(parseISO(amazonWeekStart(ymd) + 'T12:00:00'), 6), 'yyyy-MM-dd');
}

export function amazonWeekNumber(ymd: string): number {
  const monday = addDays(parseISO(amazonWeekStart(ymd) + 'T12:00:00'), 1);
  return getISOWeek(monday);
}

export function amazonWeekYear(ymd: string): number {
  const monday = addDays(parseISO(amazonWeekStart(ymd) + 'T12:00:00'), 1);
  return getISOWeekYear(monday);
}

export function amazonWeekLabel(ymd: string): string {
  return `Week${String(amazonWeekNumber(ymd)).padStart(2, '0')}`;
}

export function amazonWeekRangeFromAnchor(ymd: string): { start: string; end: string; week: number; year: number; label: string } {
  const start = amazonWeekStart(ymd);
  const end = amazonWeekEnd(ymd);
  return {
    start,
    end,
    week: amazonWeekNumber(ymd),
    year: amazonWeekYear(ymd),
    label: amazonWeekLabel(ymd),
  };
}

export function shiftAmazonWeek(weekStart: string, deltaWeeks: number): string {
  return format(addDays(parseISO(weekStart + 'T12:00:00'), deltaWeeks * 7), 'yyyy-MM-dd');
}

/** True if tour_start_la (yyyy-MM-dd) falls in [start, end] inclusive. */
export function inAmazonWeek(tourStartLa: string | null | undefined, start: string, end: string): boolean {
  if (!tourStartLa) return false;
  return tourStartLa >= start && tourStartLa <= end;
}
