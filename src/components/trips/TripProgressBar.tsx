import { cn } from '@/lib/utils';
import { buildStopProgress, plainEnglishStatus, type StopProgressNode } from '@/lib/relayTrips';
import type { RelayTrip } from '@/types';

function nodeClasses(node: StopProgressNode): string {
  if (node.state === 'done') {
    return node.late
      ? 'bg-success border-danger text-white ring-1 ring-danger'
      : 'bg-success border-success text-white';
  }
  if (node.state === 'at_stop') {
    return node.late
      ? 'bg-info border-danger text-white ring-2 ring-danger/40 ring-offset-1'
      : 'bg-info border-info text-white ring-2 ring-info/40 ring-offset-1';
  }
  // not_reached
  return node.late
    ? 'bg-card border-danger text-danger'
    : 'bg-card border-slate-300 text-text-secondary';
}

function connectorClasses(from: StopProgressNode, to: StopProgressNode): string {
  if (from.state === 'done' && (to.state === 'done' || to.state === 'at_stop')) {
    return 'border-solid border-success';
  }
  if (from.state === 'done' || from.state === 'at_stop') {
    return 'border-dashed border-slate-300';
  }
  return 'border-dashed border-slate-200';
}

export function TripProgressBar({
  trip,
  className,
}: {
  trip: RelayTrip;
  className?: string;
}) {
  const nodes = buildStopProgress(trip);
  const statusLine = plainEnglishStatus(trip);

  if (!nodes.length) {
    return (
      <div className={cn('min-w-[10rem]', className)}>
        <p className="text-xs text-text-secondary">No stops synced</p>
      </div>
    );
  }

  return (
    <div className={cn('min-w-[11rem] max-w-[18rem]', className)}>
      <div className="flex items-center gap-0.5" role="img" aria-label={statusLine}>
        {nodes.map((node, i) => (
          <div key={node.stop.id || node.stop.stopId || i} className="flex items-center min-w-0">
            <span
              title={`${node.label}${node.late ? ' · late' : ''} · ${node.state.replace('_', ' ')}`}
              className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[9px] font-semibold font-mono leading-none',
                nodeClasses(node),
              )}
            >
              {(node.label || String(i + 1)).slice(0, 4)}
            </span>
            {i < nodes.length - 1 && (
              <span
                className={cn('mx-0.5 h-0 w-3 shrink-0 border-t-2', connectorClasses(node, nodes[i + 1]))}
                aria-hidden
              />
            )}
          </div>
        ))}
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-text-secondary">{statusLine}</p>
    </div>
  );
}
