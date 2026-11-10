import { cn } from '@/lib/utils';
import type { DatePreset, DateRange } from '@/types';
import { Input } from './Input';

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This Week' },
  { key: 'last_week', label: 'Last Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'custom', label: 'Custom' },
];

export function DateRangeFilter({
  preset,
  onPresetChange,
  customRange,
  onCustomRangeChange,
  className,
}: {
  preset: DatePreset;
  onPresetChange: (p: DatePreset) => void;
  customRange?: DateRange;
  onCustomRangeChange?: (r: DateRange) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onPresetChange(p.key)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            preset === p.key
              ? 'bg-primary text-white shadow-sm'
              : 'bg-white text-text-secondary border border-border hover:bg-bg hover:text-text'
          )}
        >
          {p.label}
        </button>
      ))}
      {preset === 'custom' && customRange && onCustomRangeChange && (
        <div className="flex items-center gap-2 ml-1">
          <Input
            type="date"
            value={customRange.start}
            onChange={(e) =>
              onCustomRangeChange({ ...customRange, start: e.target.value })
            }
            className="w-auto"
          />
          <span className="text-xs text-text-secondary">to</span>
          <Input
            type="date"
            value={customRange.end}
            onChange={(e) =>
              onCustomRangeChange({ ...customRange, end: e.target.value })
            }
            className="w-auto"
          />
        </div>
      )}
    </div>
  );
}
