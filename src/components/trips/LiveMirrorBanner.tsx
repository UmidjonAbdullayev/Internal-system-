import { Button } from '@/components/ui/Button';
import type { LiveMirrorMode } from '@/types';

export function LiveMirrorBanner({
  mode,
  relayCount,
  onShowLastKnown,
}: {
  mode: LiveMirrorMode;
  relayCount?: number | null;
  onShowLastKnown: () => void;
}) {
  if (mode === 'syncing') {
    return (
      <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Syncing with Relay… counts will match Relay when the first complete snapshot lands
        {relayCount != null ? ` (Relay tile: ${relayCount})` : ''}.
      </div>
    );
  }

  if (mode === 'paused') {
    return (
      <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            Live mirror paused (no successful sync in over 5 minutes). Upcoming / In Transit stay empty
            until Relay reconnects.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="opacity-60"
            onClick={onShowLastKnown}
          >
            Show last known data
          </Button>
        </div>
      </div>
    );
  }

  if (mode === 'last_known') {
    return (
      <div className="mb-4 rounded-md border border-border bg-bg px-4 py-3 text-sm text-text-secondary">
        Showing last known data — greyed until sync resumes. Not a live Relay mirror.
      </div>
    );
  }

  return null;
}
