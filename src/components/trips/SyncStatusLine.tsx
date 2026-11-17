import type { SyncStateRow } from '@/types';
import { formatSyncAge, isSectionPaused, liveMirrorMode } from '@/lib/liveMirrors';

export function SyncStatusLine({
  syncState,
  showLastKnown = false,
  reconnectSyncing = false,
}: {
  syncState?: SyncStateRow;
  showLastKnown?: boolean;
  reconnectSyncing?: boolean;
}) {
  const mode = liveMirrorMode(syncState, { showLastKnown, reconnectSyncing });
  const age = formatSyncAge(syncState?.lastSuccessfulSyncAt);

  if (mode === 'syncing') {
    return (
      <p className="text-sm text-amber-700" role="status">
        Syncing with Relay…
      </p>
    );
  }
  if (mode === 'paused' || isSectionPaused(syncState)) {
    return (
      <p className="text-sm text-red-700" role="status">
        Sync paused — last successful sync {age}. Log in to Relay / resume extension.
      </p>
    );
  }
  if (mode === 'last_known') {
    return (
      <p className="text-sm text-text-secondary" role="status">
        Showing last known data (sync paused · {age}).
      </p>
    );
  }
  return (
    <p className="text-sm text-emerald-700" role="status">
      Last synced {age}
    </p>
  );
}
