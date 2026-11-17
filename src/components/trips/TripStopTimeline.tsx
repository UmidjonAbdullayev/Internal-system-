import { Copy, ExternalLink, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import type { RelayLeg, RelayStop, RelayTrip } from '@/types';
import {
  cptWarning,
  formatLocalStopTime,
  mapsUrl,
  minutesLate,
  stopAddressLine,
  stopTypeLabel,
  timeSourceLabel,
  tripLateReason,
} from '@/lib/relayTrips';

function legForStop(trip: RelayTrip, stop: RelayStop): RelayLeg | null {
  return trip.legs.find((l) => l.loadId === stop.loadId) || null;
}

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
}: {
  trip: RelayTrip;
  stop: RelayStop;
  index: number;
  isLast: boolean;
}) {
  const leg = legForStop(trip, stop);
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
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!isLast && (
        <span
          className="absolute left-[15px] top-8 bottom-0 w-px border-l border-dashed border-border"
          aria-hidden
        />
      )}
      <div className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-secondary bg-info-bg text-xs font-semibold text-primary">
        {stop.seq ?? index + 1}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-sm font-semibold text-text">
            {stop.facilityCode || `Stop ${stop.seq ?? index + 1}`}
          </span>
          <span className="rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
            {stopTypeLabel(stop)}
          </span>
        </div>
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
              <p className="mt-0.5 font-medium text-text">
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
  const stops = trip.legs.flatMap((l) => l.stops).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  if (!stops.length) {
    return <p className="text-sm text-text-secondary">No stops synced for this trip.</p>;
  }
  return (
    <ul className="space-y-0">
      {stops.map((stop, i) => (
        <StopBlock
          key={stop.id || stop.stopId}
          trip={trip}
          stop={stop}
          index={i}
          isLast={i === stops.length - 1}
        />
      ))}
    </ul>
  );
}
