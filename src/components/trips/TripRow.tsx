import { useMemo } from 'react';
import { ChevronDown, Copy, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { ActivityLog, Driver, RelayTrip } from '@/types';
import { cn, formatCurrency, formatDate, getDriverFullName } from '@/lib/utils';
import {
  allStops,
  facilityLabel,
  firstAndLastStop,
  formatLocalStopTime,
  leftBorderClass,
  ratePerMile,
  relayTourUrl,
  tripDriverName,
  tripDurationLabel,
  tripTractorId,
  tripTrailerId,
  workTypeLabel,
} from '@/lib/relayTrips';
import { TripProgressBar } from '@/components/trips/TripProgressBar';
import { TripStatusChips } from '@/components/trips/TripStatusChips';
import { TripStopTimeline } from '@/components/trips/TripStopTimeline';
import { TripLegsTable } from '@/components/trips/TripLegsTable';
import { Button } from '@/components/ui/Button';

function matchDriver(drivers: Driver[], name: string): Driver | null {
  if (!name) return null;
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim();
  return (
    drivers.find((d) => getDriverFullName(d.firstName, d.lastName).toLowerCase() === n) ||
    drivers.find((d) => {
      const full = getDriverFullName(d.firstName, d.lastName).toLowerCase();
      return full.includes(n) || n.includes(full);
    }) ||
    null
  );
}

export function TripRow({
  trip,
  expanded,
  selected,
  onToggle,
  drivers,
  activityLogs,
}: {
  trip: RelayTrip;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  drivers: Driver[];
  activityLogs: ActivityLog[];
}) {
  const driverName = tripDriverName(trip);
  const driver = matchDriver(drivers, driverName);
  const tractor = tripTractorId(trip);
  const trailer = tripTrailerId(trip);
  const { first, last } = firstAndLastStop(trip);
  const stops = allStops(trip);
  const extraStops = Math.max(0, stops.length - 2);
  const rpm = ratePerMile(trip);
  const pay = trip.payout;
  const miles = trip.totalMiles;

  const tripActivity = useMemo(() => {
    const ids = new Set<string>([trip.tripId, ...trip.legs.map((l) => l.loadId)]);
    return activityLogs.filter(
      (a) =>
        (a.entityId && ids.has(a.entityId)) ||
        ids.has(a.description) ||
        [...ids].some((id) => a.description.includes(id)),
    );
  }, [activityLogs, trip]);

  const openInRelay = async () => {
    try {
      await navigator.clipboard.writeText(trip.tripId);
      toast.success(`Copied ${trip.tripId}`);
    } catch {
      toast.error('Could not copy trip ID');
    }
    window.open(relayTourUrl(trip.tripId), '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      data-trip-id={trip.tripId}
      className={cn(
        'border-b border-border/70 border-l-4 bg-card transition-colors',
        leftBorderClass(trip),
        selected && 'bg-info-bg/40',
        'hover:bg-bg/80',
      )}
    >
      {/* Collapsed row — desktop table-like */}
      <div
        role="button"
        tabIndex={0}
        data-testid={`trip-row-${trip.tripId}`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="hidden md:grid w-full cursor-pointer grid-cols-[minmax(9rem,1.1fr)_minmax(8rem,1fr)_minmax(12rem,1.4fr)_minmax(11rem,1.3fr)_minmax(7rem,0.9fr)_minmax(6.5rem,0.85fr)_2rem] items-start gap-3 px-3 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-sm font-bold text-primary" title={trip.tripId}>
              {trip.tripId}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-text-secondary">
            {workTypeLabel(trip)}
            <span className="mx-1 text-border">·</span>
            {trip.legs.length} leg{trip.legs.length === 1 ? '' : 's'}
            <span className="mx-1 text-border">·</span>
            {stops.length} stop{stops.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="min-w-0">
          <div className="line-clamp-1 text-sm font-medium">
            {driverName ? (
              <span>{driverName}</span>
            ) : (
              <span className="italic text-warning">No driver</span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-text-secondary">
            <span className="font-mono">
              Tractor {tractor || <span className="text-warning font-sans font-medium">No tractor</span>}
            </span>
            <span className="mx-1">·</span>
            <span className="font-mono">Trailer {trailer || '—'}</span>
          </p>
        </div>

        <div className="min-w-0 text-xs">
          <div className="line-clamp-1 font-medium">
            {facilityLabel(first)}
            <span className="ml-1 font-normal text-text-secondary">
              {formatLocalStopTime(first?.scheduledArrival, first?.timeZone, first?.scheduledArrivalLocal)}
            </span>
          </div>
          <div className="my-0.5 text-text-secondary" aria-hidden>
            ↓
          </div>
          <div className="line-clamp-1 font-medium">
            {facilityLabel(last)}
            <span className="ml-1 font-normal text-text-secondary">
              {formatLocalStopTime(last?.scheduledArrival, last?.timeZone, last?.scheduledArrivalLocal)}
            </span>
          </div>
          {extraStops > 0 && (
            <span className="mt-1 inline-flex rounded-md border border-border bg-bg px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
              +{extraStops} stop{extraStops === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <TripProgressBar trip={trip} />

        <TripStatusChips trip={trip} />

        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">
            {pay != null ? formatCurrency(pay) : '—'}
          </div>
          <div className="text-[11px] tabular-nums text-text-secondary">
            {rpm != null ? `$${rpm.toFixed(2)}/mi` : '—/mi'}
            <span className="mx-1">·</span>
            {miles != null ? `${Math.round(miles)} mi` : '—'}
          </div>
        </div>

        <div className="flex justify-end pt-0.5">
          <ChevronDown
            className={cn('h-4 w-4 text-text-secondary transition-transform', expanded && 'rotate-180')}
            aria-hidden
          />
        </div>
      </div>

      {/* Collapsed — mobile card */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="md:hidden w-full cursor-pointer space-y-2 px-3 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-sm font-bold text-primary">{trip.tripId}</p>
            <p className="text-[11px] text-text-secondary">
              {workTypeLabel(trip)} · {trip.legs.length} legs · {stops.length} stops
            </p>
          </div>
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 text-text-secondary transition-transform', expanded && 'rotate-180')}
          />
        </div>
        <p className="text-sm font-medium line-clamp-1">{driverName || 'No driver'}</p>
        <p className="text-xs text-text-secondary line-clamp-2">
          {facilityLabel(first)} → {facilityLabel(last)}
        </p>
        <TripProgressBar trip={trip} />
        <div className="flex items-center justify-between gap-2">
          <TripStatusChips trip={trip} />
          <div className="text-right text-sm font-semibold tabular-nums">
            {pay != null ? formatCurrency(pay) : '—'}
          </div>
        </div>
      </div>

      {/* Expanded panel */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-5 border-t border-border/80 bg-bg/40 px-3 py-4 md:px-4 animate-fade-in">
            {/* A) Summary strip */}
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <SummaryStat label="Pay" value={pay != null ? formatCurrency(pay) : '—'} />
              <SummaryStat label="$/mi" value={rpm != null ? `$${rpm.toFixed(2)}` : '—'} />
              <SummaryStat label="Miles" value={miles != null ? String(Math.round(miles)) : '—'} />
              <SummaryStat label="Duration" value={tripDurationLabel(trip)} />
              <SummaryStat label="Work type" value={workTypeLabel(trip)} />
              {trip.costItems.length > 0 && (
                <SummaryStat
                  label="Tolls / costs"
                  value={trip.costItems
                    .map((c) =>
                      c.amount != null ? `${c.name} ${formatCurrency(c.amount)}` : c.name,
                    )
                    .join(' · ')}
                />
              )}
              {driver && (
                <div className="min-w-[5.5rem]">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                    Driver
                  </p>
                  <Link
                    to={`/drivers/${driver.id}`}
                    className="mt-0.5 inline-block font-medium text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {driverName}
                  </Link>
                  {driver.phone ? (
                    <p className="text-xs text-text-secondary">{driver.phone}</p>
                  ) : null}
                </div>
              )}
            </div>

            {/* B) Stop timeline */}
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Stop timeline
              </h3>
              <TripStopTimeline trip={trip} />
            </section>

            {/* C) Legs */}
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Legs
              </h3>
              <TripLegsTable trip={trip} />
            </section>

            {/* D) Activity */}
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Activity
              </h3>
              {tripActivity.length === 0 ? (
                <p className="text-sm text-text-secondary">No activity logged for this trip yet.</p>
              ) : (
                <ul className="space-y-2">
                  {tripActivity.slice(0, 20).map((a) => (
                    <li key={a.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      <span className="font-medium">{a.action}</span>
                      <span className="text-text-secondary line-clamp-2">{a.description}</span>
                      <span className="text-[11px] text-text-secondary">
                        {formatDate(a.timestamp, 'MMM d, yyyy h:mm a')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* E) Open in Relay */}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void openInRelay();
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in Relay
              </Button>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void navigator.clipboard.writeText(trip.tripId).then(
                    () => toast.success('Trip ID copied'),
                    () => toast.error('Copy failed'),
                  );
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy trip ID
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[5.5rem]">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-0.5 font-medium text-text line-clamp-2">{value}</p>
    </div>
  );
}
