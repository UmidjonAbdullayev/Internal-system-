import type {
  ExtensionHeartbeat,
  Load,
  LiveMirrorMode,
  RelaySection,
  RelayTrip,
  SyncStateRow,
  TripBucket,
} from '@/types';

export const LIVE_PAUSE_MS = 5 * 60 * 1000;
export const EXTENSION_OFFLINE_MS = 3 * 60 * 1000;
export const DEFAULT_HISTORY_RETENTION_DAYS = 45;

export function sectionForTab(tab: TripBucket | 'all'): RelaySection | null {
  if (tab === 'upcoming') return 'UPCOMING';
  if (tab === 'in_transit') return 'IN_TRANSIT';
  if (tab === 'history') return 'HISTORY';
  return null;
}

export function syncStateForSection(
  rows: SyncStateRow[],
  section: RelaySection,
): SyncStateRow | undefined {
  return rows.find((r) => r.section === section);
}

/** Sync-paused only for live sections — never driven by HISTORY. */
export function isSectionPaused(row: SyncStateRow | undefined, nowMs = Date.now()): boolean {
  if (!row?.lastSuccessfulSyncAt) return true;
  return nowMs - Date.parse(row.lastSuccessfulSyncAt) > LIVE_PAUSE_MS;
}

export function isExtensionOffline(
  heartbeat: ExtensionHeartbeat | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!heartbeat?.aliveAt) return true;
  const at = Date.parse(heartbeat.aliveAt);
  if (!Number.isFinite(at)) return true;
  return nowMs - at > EXTENSION_OFFLINE_MS;
}

export function liveMirrorMode(
  row: SyncStateRow | undefined,
  opts: {
    showLastKnown: boolean;
    reconnectSyncing?: boolean;
    heartbeat?: ExtensionHeartbeat | null;
  } = { showLastKnown: false },
): LiveMirrorMode {
  if (opts.heartbeat?.authStatus === 'auth_required') return 'auth';
  if (opts.reconnectSyncing || row?.syncing) return 'syncing';
  if (isExtensionOffline(opts.heartbeat)) return opts.showLastKnown ? 'last_known' : 'offline';
  if (isSectionPaused(row)) return opts.showLastKnown ? 'last_known' : 'delayed';
  return 'live';
}

export function historyCutoffIso(retentionDays = DEFAULT_HISTORY_RETENTION_DAYS): string {
  return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

/** History tab: keep rows whose end/delivery is within retention window. */
export function withinHistoryRetention(
  load: Load,
  retentionDays = DEFAULT_HISTORY_RETENTION_DAYS,
): boolean {
  const cutoff = historyCutoffIso(retentionDays).slice(0, 10);
  const end = load.deliveryDate || load.pickupDate || load.updatedAt?.slice(0, 10) || '';
  if (!end) return true;
  return end >= cutoff;
}

/** History retention for nested relay trips. */
export function withinTripHistoryRetention(
  trip: RelayTrip,
  retentionDays = DEFAULT_HISTORY_RETENTION_DAYS,
): boolean {
  const cutoff = historyCutoffIso(retentionDays).slice(0, 10);
  const end =
    trip.endTime?.slice(0, 10) ||
    trip.startTime?.slice(0, 10) ||
    trip.lastSeenAt?.slice(0, 10) ||
    trip.updatedAt?.slice(0, 10) ||
    '';
  if (!end) return true;
  return end >= cutoff;
}

export function loadLooksLate(load: Load): boolean {
  const note = `${load.notes || ''} ${load.statusBarState || ''}`.toLowerCase();
  if (note.includes('late')) return true;
  if (load.arrivalActual && load.arrivalScheduled) {
    const a = Date.parse(load.arrivalActual);
    const s = Date.parse(load.arrivalScheduled);
    if (Number.isFinite(a) && Number.isFinite(s) && a - s > 15 * 60 * 1000) return true;
  }
  return false;
}

export function formatSyncAge(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

export function formatClockHHMM(iso: string | null | undefined): string {
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
