import {
  Ban,
  Building2,
  CalendarCheck,
  CheckCircle2,
  CircleDashed,
  Navigation,
  PackageCheck,
  Send,
  Truck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  resolveTripStatus,
  tripStatusTooltip,
  type TripDisplayStatus,
  type TripStatusMeta,
} from '@/lib/loadStatusDisplay';
import type { Load } from '@/types';

const ICON_BY_STATUS: Record<TripDisplayStatus, LucideIcon> = {
  Available: CircleDashed,
  Booked: CalendarCheck,
  Dispatched: Send,
  'In Transit': Navigation,
  'Arrived at facility': Building2,
  'Loaded / en route': Truck,
  Delivered: PackageCheck,
  Completed: CheckCircle2,
  Cancelled: XCircle,
  Rejected: Ban,
};

const COLOR_BY_STATUS: Record<TripDisplayStatus, string> = {
  Available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Booked: 'bg-violet-50 text-violet-700 border-violet-200',
  Dispatched: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'In Transit': 'bg-blue-50 text-blue-700 border-blue-200',
  /** Relay facility-arrival cue — solid dark-blueish. */
  'Arrived at facility': 'bg-sky-800 text-white border-sky-900',
  'Loaded / en route': 'bg-sky-100 text-sky-800 border-sky-300',
  Delivered: 'bg-teal-50 text-teal-700 border-teal-200',
  Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Cancelled: 'bg-slate-100 text-slate-600 border-slate-300',
  Rejected: 'bg-red-50 text-red-700 border-red-200',
};

export function TripStatusIcon({
  load,
  showLabel = true,
  className,
}: {
  load: Pick<Load, 'loadStatus' | 'statusBarState' | 'statusStopIndex'>;
  showLabel?: boolean;
  className?: string;
}) {
  const meta = resolveTripStatus(load);
  return <TripStatusIconFromMeta meta={meta} showLabel={showLabel} className={className} />;
}

export function TripStatusIconFromMeta({
  meta,
  showLabel = true,
  className,
}: {
  meta: TripStatusMeta;
  showLabel?: boolean;
  className?: string;
}) {
  const Icon = ICON_BY_STATUS[meta.name] ?? Navigation;
  const tooltip = tripStatusTooltip(meta);

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium',
        COLOR_BY_STATUS[meta.name] ?? 'bg-slate-50 text-slate-600 border-slate-200',
        className,
      )}
      title={tooltip}
      aria-label={tooltip}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {showLabel && <span className="truncate">{meta.short}</span>}
    </span>
  );
}
