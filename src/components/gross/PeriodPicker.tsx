import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { cn, formatDate } from '@/lib/utils';
import { amazonWeekRangeFromAnchor, laTodayISO, shiftAmazonWeek } from '@/lib/amazonWeek';
import { periodRange, type PeriodMode, type PeriodState } from './period';

export function PeriodPicker({
  value,
  onChange,
  className,
}: {
  value: PeriodState;
  onChange: (next: PeriodState) => void;
  className?: string;
}) {
  const range = periodRange(value);
  const btn = (mode: PeriodMode, label: string) => (
    <button
      type="button"
      onClick={() => onChange({ ...value, mode, weekAnchor: mode === 'week' ? laTodayISO() : value.weekAnchor })}
      className={cn(
        'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
        value.mode === mode
          ? 'bg-primary text-white shadow-sm'
          : 'border border-border bg-white text-text-secondary hover:bg-bg hover:text-text',
      )}
    >
      {label}
    </button>
  );
  const shift = (delta: number) => {
    const start = amazonWeekRangeFromAnchor(value.weekAnchor).start;
    onChange({ ...value, mode: 'week', weekAnchor: shiftAmazonWeek(start, delta) });
  };
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {btn('week', 'This week')}
      {btn('month', 'This month')}
      {btn('custom', 'Custom')}
      {value.mode === 'week' && (
        <div className="flex items-center gap-1 rounded-lg border border-border bg-white px-1 py-0.5">
          <button type="button" className="rounded p-1 hover:bg-bg" onClick={() => shift(-1)} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-1 text-xs font-medium tabular-nums">
            {formatDate(range.start, 'MMM d')} – {formatDate(range.end, 'MMM d, yyyy')}
          </span>
          <button type="button" className="rounded p-1 hover:bg-bg" onClick={() => shift(1)} aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
      {value.mode === 'custom' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="h-8 w-36"
            value={value.custom.start}
            onChange={(e) => onChange({ ...value, custom: { ...value.custom, start: e.target.value } })}
          />
          <span className="text-xs text-text-secondary">to</span>
          <Input
            type="date"
            className="h-8 w-36"
            value={value.custom.end}
            onChange={(e) => onChange({ ...value, custom: { ...value.custom, end: e.target.value } })}
          />
        </div>
      )}
    </div>
  );
}
