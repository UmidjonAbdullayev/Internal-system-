import { Badge } from '@/components/ui/Badge';
import { cn, statusColor } from '@/lib/utils';
import { deriveTimingChip, displayStatusLabel, type TimingChip } from '@/lib/relayTrips';
import type { RelayTrip } from '@/types';

function timingClasses(chip: TimingChip): string {
  switch (chip.kind) {
    case 'on_time':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'running_late':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'late_no_reason':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'late':
    default:
      return 'bg-orange-50 text-orange-800 border-orange-200';
  }
}

export function TripStatusChips({ trip }: { trip: RelayTrip }) {
  const status = displayStatusLabel(trip);
  const timing = deriveTimingChip(trip);

  return (
    <div className="flex flex-col items-start gap-1">
      <span
        className={cn(
          'inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-xs font-medium',
          statusColor(status),
        )}
        title={trip.executionStatus || trip.tourState || trip.status || status}
      >
        {status}
      </span>
      {timing && (
        <span
          className={cn(
            'inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[11px] font-medium',
            timingClasses(timing),
          )}
          title={timing.tooltip}
        >
          {timing.label}
        </span>
      )}
    </div>
  );
}

/** Re-export Badge for callers that still want a simple status pill. */
export { Badge };
