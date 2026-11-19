import { Copy, ExternalLink, MapPin, User } from 'lucide-react';
import { toast } from 'sonner';
import type { RelayStop, RelayTrip } from '@/types';
import { cn } from '@/lib/utils';
import {
  allStops,
  buildStopStatuses,
  cptWarning,
  formatLocalStopTime,
  legDriverName,
  legForStop,
  mapsUrl,
  minutesLate,
  stopAddressLine,
  stopTypeLabel,
  timeSourceLabel,
  tripDriverNames,
  tripLateReason,
  type StopStatus,
  type StopStatusKind,
} from '@/lib/relayTrips';

/** Colours per stop state — same meaning as the progress bar (see Legend). */
const STATE_STYLE: Record<
  StopStatusKind,
  { circle: string; badge: string; word: string; line: string }
> = {
  done: {
    circle: 'border-success bg-success text-white',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    word: 'text-emerald-700',
    line: 'text-emerald-800',
  },
  at_stop: {
    circle: 'border-info bg-info text-white ring-2 ring-info/40 ring-offset-1',
    badge: 'border-blue-300 bg-blue-50 text-blue-700',
    word: 'text-blue-700',
    line: 'text-blue-800 font-medium',
  },
  next: {
    circle: 'border-2 border-info bg-card text-info',
    badge: 'border-blue-200 bg-white text-blue-700',
    word: 'text-blue-700',
    line: 'text-text',
  },
  next_late: {
    circle: 'border-2 border-danger bg-danger-bg text-danger',
    badge: 'border-red-200 bg-red-50 text-red-700',
    word: 'text-red-700',
    line: 'text-red-700 font-medium',
  },
  upcoming: {
    circle: 'border-slate-300 bg-card text-text-secondary',
    badge: 'border-border bg-bg text-text-secondary',
    word: 'text-text-secondary',
    line: 'text-text-secondary',
  },
  cancelled: {
    circle: 'border-dashed border-slate-300 bg-slate-50 text-slate-400',
    badge: 'border-slate-200 bg-slate-50 text-slate-400 line-through',
    word: 'text-slate-400',
    line: 'text-slate-400',
  },
};

const TIMING_STYLE = {
  early: 'text-blue-700',
  on_time: 'text-emerald-700',
  late: 'text-red-700',
} as const;

function copyText(label: string, value: string) {
  void navigator.clipboard.writeText(value).then(
    () => toast.success(`${label} copied`),
    () => toast.error('Copy failed'),
  );
}

function lateSuffix(mins: number | null): string {
  return mins != null ? ` · ${mins}m late` : '';
}

function StopBlock({
  trip,
  stop,
  index,
  isLast,
  status,
  showDriver,
}: {
  trip: RelayTrip;
  stop: RelayStop;
  index: number;
  isLast: boolean;
  status: StopStatus;
  showDriver: boolean;
}) {
  const leg = legForStop(trip, stop);
  const style = STATE_STYLE[status.kind];
  const driver = legDriverName(trip, leg);
  const address = stopAddressLine(stop);
  // CPT only when no CHECKOUT actual and CPT already passed (see cptWarning).
  const showCpt =
    Boolean(leg?.cpt) &&
    !stop.actualDeparture &&
    (Boolean(stop.actualArrival) || (stop.seq ?? index + 1) === 1);
  const cpt = showCpt ? cptWarning(stop, leg) : null;
  const lateReason = stop.lateReason || (index === 0 ? tripLateReason(trip) : null);
  const schArr = formatLocalStopTime(stop.scheduledArrival, stop.timeZone, stop.scheduledArrivalLocal);
  const actArr = formatLocalStopTime(stop.actualArrival, stop.timeZone, stop.actualArrivalLocal);
  const schDep = formatLocalStopTime(
    stop.scheduledDeparture,
    stop.timeZone,
    stop.scheduledDepartureLocal,
  );
  const actDep = formatLocalStopTime(
    stop.actualDeparture,
    stop.timeZone,
    stop.actualDepartureLocal,
  );
  const arrLate = minutesLate(stop.actualArrival, stop.scheduledArrival);
  const depLate = minutesLate(stop.actualDeparture, stop.scheduledDeparture);
  const arrSource = timeSourceLabel(stop, 'arrival');
  const depSource = timeSourceLabel(stop, 'departure');
  const etaArr = formatLocalStopTime(stop.eta, stop.timeZone, stop.etaLocal);

  return (
    <li
      className={cn('relative flex gap-3 pb-5 last:pb-0', status.kind === 'cancelled' && 'opacity-70')}
      data-stop-state={status.kind}
    >
      {!isLast && (
        <span
          className={cn(
            'absolute left-[15px] top-8 bottom-0 w-px border-l',
            status.kind === 'done' ? 'border-solid border-success' : 'border-dashed border-border',
          )}
          aria-hidden
        />
      )}
      <div
        className={cn(
          'relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
          style.circle,
        )}
        title={status.label}
      >
        {index + 1}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'font-mono text-sm font-semibold',
              status.kind === 'cancelled' ? 'text-slate-400 line-through' : 'text-text',
            )}
          >
            {stop.facilityCode || `Stop ${stop.seq ?? index + 1}`}
          </span>
          <span
            className={cn(
              'rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              style.badge,
            )}
          >
            {stopTypeLabel(stop)}
          </span>
          <span className={cn('text-[11px] font-semibold uppercase tracking-wide', style.word)}>
            {status.label}
          </span>
          {showDriver && driver && (
            <span className="inline-flex items-center gap-1 rounded-md bg-bg px-1.5 py-0.5 text-[11px] text-text-secondary">
              <User className="h-3 w-3" aria-hidden />
              {driver}
            </span>
          )}
          {stop.loadId && (
            <span className="font-mono text-[10px] text-text-secondary">Load {stop.loadId}</span>
          )}
        </div>
        <p className={cn('text-xs', style.line)}>{status.line}</p>
        {address && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="line-clamp-2">{address}</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              onClick={() => copyText('Address', address)}
              title="Copy address"
            >
              <Copy className="h-3 w-3" />
              Copy
            </button>
            <a
              href={mapsUrl(stop)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              title="Open in Google Maps"
            >
              <ExternalLink className="h-3 w-3" />
              Maps
            </a>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2 text-xs">
          <div className="rounded-md bg-bg/80 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              Arrival
            </p>
            {schArr !== '—' ? (
              <p className="mt-0.5 text-text-secondary">Sch {schArr}</p>
            ) : (
              <p className="mt-0.5 text-text-secondary">Sch —</p>
            )}
            {actArr !== '—' ? (
              <p
                className={cn(
                  'mt-0.5 font-medium',
                  status.arrivalTiming ? TIMING_STYLE[status.arrivalTiming] : 'text-text',
                )}
              >
                Actual {actArr}
                {lateSuffix(arrLate)}
              </p>
            ) : etaArr !== '—' ? (
              <p className="mt-0.5 font-medium text-text">ETA {etaArr}</p>
            ) : (
              <p className="mt-0.5 font-medium text-text">Actual —</p>
            )}
            {arrSource && (
              <p className="mt-0.5 text-[10px] text-text-secondary">{arrSource}</p>
            )}
          </div>
          <div className="rounded-md bg-bg/80 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              Departure
            </p>
            {schDep !== '—' ? (
              <p className="mt-0.5 text-text-secondary">Sch {schDep}</p>
            ) : (
              <p className="mt-0.5 text-text-secondary">Sch —</p>
            )}
            {actDep !== '—' ? (
              <p className="mt-0.5 font-medium text-text">
                Actual {actDep}
                {lateSuffix(depLate)}
              </p>
            ) : (
              <p className="mt-0.5 font-medium text-text">Actual —</p>
            )}
            {depSource && (
              <p className="mt-0.5 text-[10px] text-text-secondary">{depSource}</p>
            )}
          </div>
        </div>
        {cpt && <p className="text-xs font-medium text-danger">{cpt}</p>}
        {lateReason && (
          <p className="text-xs text-text-secondary">Late reason: {lateReason}</p>
        )}
      </div>
    </li>
  );
}

export function TripStopTimeline({ trip }: { trip: RelayTrip }) {
  const stops = allStops(trip);
  if (!stops.length) {
    return <p className="text-sm text-text-secondary">No stops synced for this trip.</p>;
  }
  const statuses = buildStopStatuses(trip);
  const multiDriver = tripDriverNames(trip).length > 1;
  return (
    <ul className="space-y-0">
      {stops.map((stop, i) => (
        <StopBlock
          key={stop.id || stop.stopId}
          trip={trip}
          stop={stop}
          index={i}
          isLast={i === stops.length - 1}
          status={statuses.get(stop)!}
          showDriver={multiDriver}
        />
      ))}
    </ul>
  );
}
