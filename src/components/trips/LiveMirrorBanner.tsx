import { Button } from '@/components/ui/Button';
import { formatClockHHMM } from '@/lib/liveMirrors';
import type { LiveMirrorMode } from '@/types';

export function LiveMirrorBanner({
  mode,
  relayCount,
  sectionLabel = 'IN_TRANSIT',
  lastSuccessfulSyncAt,
  extensionAliveAt,
  onShowLastKnown,
}: {
  mode: LiveMirrorMode;
  relayCount?: number | null;
  sectionLabel?: string;
  lastSuccessfulSyncAt?: string | null;
  extensionAliveAt?: string | null;
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

  if (mode === 'auth') {
    return (
      <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        Logged out of Relay. Log in again.
      </div>
    );
  }

  if (mode === 'offline') {
    const since = formatClockHHMM(extensionAliveAt);
    return (
      <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>Extension offline{since ? ` since ${since}` : ''}.</p>
          <Button type="button" variant="outline" size="sm" onClick={onShowLastKnown}>
            Show last known data
          </Button>
        </div>
      </div>
    );
  }

  if (mode === 'delayed' || mode === 'paused') {
    const since = formatClockHHMM(lastSuccessfulSyncAt);
    return (
      <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            Relay sync delayed ({sectionLabel} last {since || '—'}). Retrying…
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
