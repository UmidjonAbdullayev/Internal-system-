import type { RelayTrip } from '@/types';
import { cn, formatCurrency } from '@/lib/utils';
import {
  compareStops,
  facilityLabel,
  isLegCancelled,
  legDriverName,
  legLoadTypeLabel,
  orderedLegs,
} from '@/lib/relayTrips';

export function TripLegsTable({ trip }: { trip: RelayTrip }) {
  const legs = orderedLegs(trip);
  if (!legs.length) {
    return <p className="text-sm text-text-secondary">No legs synced for this trip.</p>;
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              <th className="px-2 py-2">Load ID</th>
              <th className="px-2 py-2">From → To</th>
              <th className="px-2 py-2">Driver</th>
              <th className="px-2 py-2 text-right">Miles</th>
              <th className="px-2 py-2 text-right">Pay</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Tractor</th>
              <th className="px-2 py-2">Trailer</th>
              <th className="px-2 py-2">Type</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((leg) => {
              const stops = [...leg.stops].sort(compareStops);
              const first = stops[0];
              const last = stops[stops.length - 1];
              const cancelled = isLegCancelled(leg);
              return (
                <tr
                  key={leg.id || leg.loadId}
                  className={cn(
                    'border-b border-border/60',
                    cancelled && 'bg-slate-50/80 text-slate-400',
                  )}
                >
                  <td
                    className={cn(
                      'px-2 py-2 font-mono text-xs font-semibold',
                      cancelled ? 'text-slate-400' : 'text-primary',
                    )}
                  >
                    {leg.loadId}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    <div className="line-clamp-1">{facilityLabel(first)}</div>
                    <div className={cn('line-clamp-1', cancelled ? 'text-slate-400' : 'text-text-secondary')}>
                      → {facilityLabel(last)}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-xs">{legDriverName(trip, leg) || '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs">
                    {leg.miles != null ? Math.round(leg.miles) : '—'}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs font-medium">
                    {leg.payout != null ? formatCurrency(leg.payout) : '—'}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {cancelled ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Leg cancelled
                        </span>
                      </span>
                    ) : (
                      leg.executionStatus || '—'
                    )}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{leg.tractorId || '—'}</td>
                  <td className="px-2 py-2 font-mono text-xs">{leg.trailerId || '—'}</td>
                  <td className="px-2 py-2 text-xs">{legLoadTypeLabel(leg)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {legs.map((leg) => {
          const stops = [...leg.stops].sort(compareStops);
          const first = stops[0];
          const last = stops[stops.length - 1] || first;
          const cancelled = isLegCancelled(leg);
          return (
            <div
              key={leg.id || leg.loadId}
              className={cn(
                'rounded-lg border p-3',
                cancelled
                  ? 'border-slate-200 bg-slate-50 text-slate-400'
                  : 'border-border bg-bg/60',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className={cn(
                    'font-mono text-sm font-semibold',
                    cancelled ? 'text-slate-400' : 'text-primary',
                  )}
                >
                  {leg.loadId}
                </p>
                {cancelled && (
                  <span className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Leg cancelled
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs line-clamp-2">
                {facilityLabel(first)} → {facilityLabel(last)}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-secondary">
                <span className="font-medium text-text">{legDriverName(trip, leg) || 'No driver'}</span>
                <span>{leg.miles != null ? `${Math.round(leg.miles)} mi` : '— mi'}</span>
                <span>{leg.payout != null ? formatCurrency(leg.payout) : '—'}</span>
                <span className="font-mono">{leg.tractorId || 'No tractor'}</span>
                <span className="font-mono">{leg.trailerId || 'No trailer'}</span>
                <span>{legLoadTypeLabel(leg)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
