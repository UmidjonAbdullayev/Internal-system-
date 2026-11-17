import type { RelayTrip } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { facilityLabel, legLoadTypeLabel } from '@/lib/relayTrips';

export function TripLegsTable({ trip }: { trip: RelayTrip }) {
  if (!trip.legs.length) {
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
              <th className="px-2 py-2 text-right">Miles</th>
              <th className="px-2 py-2 text-right">Pay</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Tractor</th>
              <th className="px-2 py-2">Trailer</th>
              <th className="px-2 py-2">Type</th>
            </tr>
          </thead>
          <tbody>
            {trip.legs.map((leg) => {
              const stops = [...leg.stops].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
              const first = stops[0];
              const last = stops[stops.length - 1];
              return (
                <tr key={leg.id || leg.loadId} className="border-b border-border/60">
                  <td className="px-2 py-2 font-mono text-xs font-semibold text-primary">
                    {leg.loadId}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    <div className="line-clamp-1">{facilityLabel(first)}</div>
                    <div className="line-clamp-1 text-text-secondary">→ {facilityLabel(last)}</div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs">
                    {leg.miles != null ? Math.round(leg.miles) : '—'}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs font-medium">
                    {leg.payout != null ? formatCurrency(leg.payout) : '—'}
                  </td>
                  <td className="px-2 py-2 text-xs">{leg.executionStatus || '—'}</td>
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
        {trip.legs.map((leg) => {
          const stops = [...leg.stops].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
          const first = stops[0];
          const last = stops[stops.length - 1] || first;
          return (
            <div key={leg.id || leg.loadId} className="rounded-lg border border-border bg-bg/60 p-3">
              <p className="font-mono text-sm font-semibold text-primary">{leg.loadId}</p>
              <p className="mt-1 text-xs line-clamp-2">
                {facilityLabel(first)} → {facilityLabel(last)}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-secondary">
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
