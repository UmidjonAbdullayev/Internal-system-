import type { ExtensionHeartbeat, SyncStateRow } from '@/types';
import {
  formatClockHHMM,
  formatSyncAge,
  isSectionPaused,
  liveMirrorMode,
} from '@/lib/liveMirrors';

export function SyncStatusLine({
  syncState,
  showLastKnown = false,
  reconnectSyncing = false,
  heartbeat = null,
  sectionLabel = 'IN_TRANSIT',
}: {
  syncState?: SyncStateRow;
  showLastKnown?: boolean;
  reconnectSyncing?: boolean;
  heartbeat?: ExtensionHeartbeat | null;
  sectionLabel?: string;
}) {
  const mode = liveMirrorMode(syncState, { showLastKnown, reconnectSyncing, heartbeat });
  const age = formatSyncAge(syncState?.lastSuccessfulSyncAt);
  const lastHH = formatClockHHMM(syncState?.lastSuccessfulSyncAt);
  const aliveHH = formatClockHHMM(heartbeat?.aliveAt);

  if (mode === 'syncing') {
    return (
      <p className="text-sm text-amber-700" role="status">
        Syncing with Relay…
      </p>
    );
  }
  if (mode === 'auth') {
    return (
      <p className="text-sm text-red-700" role="status">
        Logged out of Relay. Log in again.
      </p>
    );
  }
  if (mode === 'offline') {
    return (
      <p className="text-sm text-red-700" role="status">
        Extension offline{aliveHH ? ` since ${aliveHH}` : ''}.
      </p>
    );
  }
  if (mode === 'delayed' || mode === 'paused' || isSectionPaused(syncState)) {
    return (
      <p className="text-sm text-amber-800" role="status">
        Relay sync delayed ({sectionLabel} last {lastHH || age}). Retrying…
      </p>
    );
  }
  if (mode === 'last_known') {
    return (
      <p className="text-sm text-text-secondary" role="status">
        Showing last known data (sync delayed · {age}).
      </p>
    );
  }
  return (
    <p className="text-sm text-emerald-700" role="status">
      Last synced {age}
    </p>
  );
}
