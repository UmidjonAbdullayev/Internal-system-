import { getMonthRange } from '@/lib/calculations';
import { amazonWeekRangeFromAnchor, laTodayISO } from '@/lib/amazonWeek';
import type { DateRange } from '@/types';

export type PeriodMode = 'week' | 'month' | 'custom';

export type PeriodState = { mode: PeriodMode; weekAnchor: string; custom: DateRange };

export function defaultPeriod(): PeriodState {
  const today = laTodayISO();
  const w = amazonWeekRangeFromAnchor(today);
  return { mode: 'week', weekAnchor: today, custom: { start: w.start, end: w.end } };
}

/** Amazon week (Sun–Sat, LA) / this month / custom — the range used for money. */
export function periodRange(p: PeriodState): DateRange {
  if (p.mode === 'month') return getMonthRange(laTodayISO());
  if (p.mode === 'custom') return p.custom;
  const w = amazonWeekRangeFromAnchor(p.weekAnchor);
  return { start: w.start, end: w.end };
}

