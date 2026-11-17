import { Button } from '@/components/ui/Button';
import type { LiveMirrorMode } from '@/types';

function formatPausedSince(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return '';
  }
}

export function LiveMirrorBanner({
  mode,
  relayCount,
  lastSuccessfulSyncAt,
  onShowLastKnown,
}: {
  mode: LiveMirrorMode;
  relayCount?: number | null;
  lastSuccessfulSyncAt?: string | null;
  onShowLastKnown: () => void;
}) {
  if (mode === 'syncing') {
    return (
      <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Syncing with Relay… showing last known trips
        {relayCount != null ? ` (Relay tile: ${relayCount})` : ''}.
      </div>
    );
  }

  if (mode === 'paused') {
    const since = formatPausedSince(lastSuccessfulSyncAt);
    return (
      <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            Live data paused{since ? ` since ${since}` : ' (no successful sync in over 5 minutes)'}.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onShowLastKnown}>
            Show last known data
          </Button>
        </div>
      </div>
    );
  }

  if (mode === 'last_known') {
    return (
      <div className="mb-4 rounded-md border border-border bg-bg px-4 py-3 text-sm text-text-secondary">
        Showing last known data until sync resumes.
      </div>
    );
  }

  return null;
}
