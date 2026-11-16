import type { Load, LoadStatus, StatusBarState } from '@/types';

/** Relay-aligned display status used in CRM Loads (unique names for icons/tooltips). */
export type TripDisplayStatus =
  | 'Available'
  | 'Booked'
  | 'Dispatched'
  | 'In Transit'
  | 'Arrived at facility'
  | 'Loaded / en route'
  | 'Delivered'
  | 'Completed'
  | 'Cancelled'
  | 'Rejected';

export interface TripStatusMeta {
  /** Full status name (tooltip / title). */
  name: TripDisplayStatus;
  /** Short label next to the icon. */
  short: string;
  /** Optional stop index for arrived / en-route. */
  stopIndex: number | null;
  /** Underlying load_status for filters. */
  loadStatus: LoadStatus;
  /** Underlying status_bar_state when present. */
  barState: StatusBarState | null;
}

/**
 * Prefer Relay status-bar nuance over the coarse load_status when the trip is live.
 * Arrived (solid dark-blue facility cue) and Loaded/en route get unique names.
 */
export function resolveTripStatus(load: Pick<Load, 'loadStatus' | 'statusBarState' | 'statusStopIndex'>): TripStatusMeta {
  const loadStatus = load.loadStatus;
  const bar = load.statusBarState || null;
  const stop = load.statusStopIndex ?? null;

  if (loadStatus === 'Cancelled' || bar === 'cancelled') {
    return {
      name: 'Cancelled',
      short: 'Cancelled',
      stopIndex: stop,
      loadStatus: 'Cancelled',
      barState: bar,
    };
  }
  if (loadStatus === 'Rejected') {
    return {
      name: 'Rejected',
      short: 'Rejected',
      stopIndex: stop,
      loadStatus,
      barState: bar,
    };
  }
  if (loadStatus === 'Completed' || bar === 'completed') {
    return {
      name: 'Completed',
      short: 'Completed',
      stopIndex: stop,
      loadStatus: 'Completed',
      barState: bar,
    };
  }
  if (loadStatus === 'Delivered') {
    return {
      name: 'Delivered',
      short: 'Delivered',
      stopIndex: stop,
      loadStatus,
      barState: bar,
    };
  }
  if (bar === 'arrived') {
    return {
      name: 'Arrived at facility',
      short: 'Arrived',
      stopIndex: stop,
      loadStatus,
      barState: bar,
    };
  }
  if (bar === 'loaded_enroute') {
    return {
      name: 'Loaded / en route',
      short: 'En route',
      stopIndex: stop,
      loadStatus,
      barState: bar,
    };
  }
  if (loadStatus === 'In Transit' || loadStatus === 'Dispatched') {
    return {
      name: loadStatus === 'Dispatched' ? 'Dispatched' : 'In Transit',
      short: loadStatus === 'Dispatched' ? 'Dispatched' : 'In Transit',
      stopIndex: stop,
      loadStatus,
      barState: bar,
    };
  }
  if (loadStatus === 'Booked') {
    return {
      name: 'Booked',
      short: 'Booked',
      stopIndex: stop,
      loadStatus,
      barState: bar,
    };
  }
  if (loadStatus === 'Available') {
    return {
      name: 'Available',
      short: 'Available',
      stopIndex: stop,
      loadStatus,
      barState: bar,
    };
  }
  return {
    name: loadStatus,
    short: loadStatus,
    stopIndex: stop,
    loadStatus,
    barState: bar,
  };
}

export function tripStatusTooltip(meta: TripStatusMeta): string {
  if (
    (meta.name === 'Arrived at facility' || meta.name === 'Loaded / en route') &&
    meta.stopIndex != null
  ) {
    return `${meta.name} · stop ${meta.stopIndex}`;
  }
  return meta.name;
}
