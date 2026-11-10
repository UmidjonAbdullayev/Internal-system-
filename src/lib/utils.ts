import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  format,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  subDays,
  subWeeks,
  isWithinInterval,
  addDays,
} from 'date-fns';
import type { DatePreset, DateRange } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(amount));
}

export function formatNumber(n: number, decimals = 0): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatPercent(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

export function formatDate(date: string | Date, fmt = 'MMM d, yyyy'): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, fmt);
}

export function formatShortDate(date: string | Date): string {
  return formatDate(date, 'MMM d');
}

export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function getWeekRange(date: Date | string = new Date()): DateRange {
  const d = typeof date === 'string' ? parseISO(date) : date;
  const start = startOfWeek(d, { weekStartsOn: 1 });
  const end = endOfWeek(d, { weekStartsOn: 1 });
  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(end, 'yyyy-MM-dd'),
  };
}

export function getDateRangeFromPreset(preset: DatePreset, custom?: DateRange): DateRange {
  const today = new Date();
  switch (preset) {
    case 'today':
      return {
        start: format(startOfDay(today), 'yyyy-MM-dd'),
        end: format(endOfDay(today), 'yyyy-MM-dd'),
      };
    case 'yesterday': {
      const y = subDays(today, 1);
      return {
        start: format(startOfDay(y), 'yyyy-MM-dd'),
        end: format(endOfDay(y), 'yyyy-MM-dd'),
      };
    }
    case 'this_week':
      return getWeekRange(today);
    case 'last_week':
      return getWeekRange(subWeeks(today, 1));
    case 'this_month':
      return {
        start: format(startOfMonth(today), 'yyyy-MM-dd'),
        end: format(endOfMonth(today), 'yyyy-MM-dd'),
      };
    case 'last_month': {
      const lastMonth = subDays(startOfMonth(today), 1);
      return {
        start: format(startOfMonth(lastMonth), 'yyyy-MM-dd'),
        end: format(endOfMonth(lastMonth), 'yyyy-MM-dd'),
      };
    }
    case 'custom':
      return custom ?? getWeekRange(today);
    default:
      return getWeekRange(today);
  }
}

export function isDateInRange(date: string, range: DateRange): boolean {
  const d = parseISO(date);
  return isWithinInterval(d, {
    start: parseISO(range.start),
    end: parseISO(range.end),
  });
}

export function getDriverFullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`;
}

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function daysInRange(range: DateRange): string[] {
  const days: string[] = [];
  let current = parseISO(range.start);
  const end = parseISO(range.end);
  while (current <= end) {
    days.push(format(current, 'yyyy-MM-dd'));
    current = addDays(current, 1);
  }
  return days;
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    Active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'On Load': 'bg-blue-50 text-blue-700 border-blue-200',
    'On Break': 'bg-amber-50 text-amber-700 border-amber-200',
    Inactive: 'bg-slate-50 text-slate-600 border-slate-200',
    Suspended: 'bg-red-50 text-red-700 border-red-200',
    Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Delivered: 'bg-teal-50 text-teal-700 border-teal-200',
    'In Transit': 'bg-blue-50 text-blue-700 border-blue-200',
    Dispatched: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    Booked: 'bg-violet-50 text-violet-700 border-violet-200',
    Pending: 'bg-amber-50 text-amber-700 border-amber-200',
    Cancelled: 'bg-slate-50 text-slate-600 border-slate-200',
    Rejected: 'bg-red-50 text-red-700 border-red-200',
    Paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Processing: 'bg-blue-50 text-blue-700 border-blue-200',
    'Not Received': 'bg-slate-50 text-slate-600 border-slate-200',
    'On Hold': 'bg-orange-50 text-orange-700 border-orange-200',
    Disputed: 'bg-red-50 text-red-700 border-red-200',
    Draft: 'bg-slate-50 text-slate-600 border-slate-200',
    'Under Review': 'bg-amber-50 text-amber-700 border-amber-200',
    Approved: 'bg-sky-50 text-sky-700 border-sky-200',
    'Partially Paid': 'bg-orange-50 text-orange-700 border-orange-200',
  };
  return map[status] ?? 'bg-slate-50 text-slate-600 border-slate-200';
}
