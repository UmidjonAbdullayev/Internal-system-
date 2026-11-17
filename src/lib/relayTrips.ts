import type {
  RelayLeg,
  RelaySection,
  RelaySectionSnapshot,
  RelayStop,
  RelaySyncHealth,
  RelayTrip,
  TripBucket,
} from '@/types';

export type TripTab = TripBucket | 'all';

export type StopProgressState = 'done' | 'at_stop' | 'not_reached';

export type TimingChipKind = 'on_time' | 'late' | 'running_late' | 'late_no_reason';

export interface TimingChip {
  kind: TimingChipKind;
  label: string;
  tooltip: string;
}

export interface StopProgressNode {
  stop: RelayStop;
  state: StopProgressState;
  label: string;
  /** True when this stop is / was late (red outline). */
  late: boolean;
}

/** Match extension “unseen → removed” window; avoid flapping while a section is mid-scan. */
const STALE_SYNC_MS = 10 * 60 * 1000;

export function sectionToTab(section: RelaySection | null | undefined): TripBucket | null {
  if (section === 'IN_TRANSIT') return 'in_transit';
  if (section === 'UPCOMING') return 'upcoming';
  if (section === 'HISTORY') return 'history';
  return null;
}

export function tabToSection(tab: TripTab): RelaySection | null {
  if (tab === 'in_transit') return 'IN_TRANSIT';
  if (tab === 'upcoming') return 'UPCOMING';
  if (tab === 'history') return 'HISTORY';
  return null;
}

export function allStops(trip: RelayTrip): RelayStop[] {
  const stops: RelayStop[] = [];
  for (const leg of trip.legs) {
    for (const s of leg.stops) stops.push(s);
  }
  return stops.sort((a, b) => {
    if (a.tripId !== b.tripId) return 0;
    return (a.seq ?? 0) - (b.seq ?? 0);
  });
}

export function primaryLeg(trip: RelayTrip): RelayLeg | null {
  return trip.legs[0] || null;
}

export function tripDriverName(trip: RelayTrip): string {
  if (trip.driverNameRaw) return trip.driverNameRaw;
  for (const leg of trip.legs) {
    if (leg.driverNameRaw) return leg.driverNameRaw;
  }
  return '';
}

export function tripTractorId(trip: RelayTrip): string {
  for (const leg of trip.legs) {
    if (leg.tractorId) return leg.tractorId;
  }
  return '';
}

export function tripTrailerId(trip: RelayTrip): string {
  for (const leg of trip.legs) {
    if (leg.trailerId) return leg.trailerId;
  }
  return '';
}

export function workTypeLabel(trip: RelayTrip): string {
  const raw = trip.workType || trip.businessType || '';
  const u = raw.toUpperCase();
  if (!u) return '—';
  if (u.includes('SPOT')) return 'Spot';
  if (u.includes('CONTRACT') || u.includes('DEDICATED')) return 'Contract';
  return raw
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatLocalStopTime(
  iso: string | null | undefined,
  timeZone?: string | null,
  localFallback?: string | null,
): string {
  if (localFallback) return localFallback;
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const opts: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    };
    if (timeZone) opts.timeZone = timeZone;
    return new Intl.DateTimeFormat('en-US', opts).format(d).replace(/\u202f/g, ' ');
  } catch {
    return '—';
  }
}

export function facilityLabel(stop: RelayStop | null | undefined): string {
  if (!stop) return '—';
  const code = stop.facilityCode || 'Stop';
  const city = [stop.city, stop.state].filter(Boolean).join(', ');
  return city ? `${code} · ${city}` : code;
}

export function stopAddressLine(stop: RelayStop): string {
  return [stop.address, stop.city, stop.state, stop.zip].filter(Boolean).join(', ');
}

export function mapsUrl(stop: RelayStop): string {
  const q = stopAddressLine(stop) || stop.facilityCode || '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function isPickup(stop: RelayStop): boolean {
  const t = String(stop.stopType || '').toUpperCase();
  return t.includes('PICK') || t === 'PU' || t.includes('ORIGIN');
}

function isDrop(stop: RelayStop): boolean {
  const t = String(stop.stopType || '').toUpperCase();
  return t.includes('DROP') || t.includes('DELIVER') || t === 'DO' || t.includes('DEST');
}

export function stopTypeLabel(stop: RelayStop): string {
  if (isPickup(stop)) return 'PICKUP';
  if (isDrop(stop)) return 'DROP';
  const t = stop.stopType;
  if (!t) return 'STOP';
  return t.replace(/_/g, ' ').toUpperCase();
}

function lateReasonFromRaw(raw: Record<string, unknown> | undefined): string | null {
  if (!raw) return null;
  const keys = [
    'lateReason',
    'late_reason',
    'delayReason',
    'delay_reason',
    'reasonCode',
    'disruptionReason',
  ];
  for (const k of keys) {
    const v = raw[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

export function tripLateReason(trip: RelayTrip): string | null {
  const fromTrip = lateReasonFromRaw(trip.raw);
  if (fromTrip) return fromTrip;
  for (const leg of trip.legs) {
    const r = lateReasonFromRaw(leg.raw);
    if (r) return r;
    for (const stop of leg.stops) {
      const sr = lateReasonFromRaw(stop.raw);
      if (sr) return sr;
    }
  }
  return null;
}

function statusLooksLate(status: string | null | undefined): boolean {
  if (!status) return false;
  return /late|delay|disrupt/i.test(status);
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export function isStopLate(stop: RelayStop, now = Date.now()): boolean {
  const scheduled = ms(stop.scheduledArrival);
  if (scheduled == null) return false;
  if (stop.actualArrival) {
    const actual = ms(stop.actualArrival);
    return actual != null && actual > scheduled + 5 * 60 * 1000;
  }
  if (stop.actualDeparture) return false;
  // Not arrived yet and past schedule → late / running late
  return now > scheduled + 5 * 60 * 1000;
}

export function buildStopProgress(trip: RelayTrip, now = Date.now()): StopProgressNode[] {
  const stops = allStops(trip);
  return stops.map((stop) => {
    const late = isStopLate(stop, now);
    let state: StopProgressState = 'not_reached';
    if (stop.actualDeparture) {
      state = 'done';
    } else if (stop.actualArrival) {
      state = 'at_stop';
    } else {
      state = 'not_reached';
    }
    // History: arrived-or-departed counts as done for the bar
    if (trip.section === 'HISTORY' && (stop.actualArrival || stop.actualDeparture)) {
      state = 'done';
    }
    return {
      stop,
      state,
      label: stop.facilityCode || String(stop.seq ?? ''),
      late,
    };
  });
}

export function deriveTimingChip(trip: RelayTrip, now = Date.now()): TimingChip | null {
  const reason = tripLateReason(trip);
  const progress = buildStopProgress(trip, now);
  const anyLate = progress.some((p) => p.late);
  const statusLate = statusLooksLate(trip.status) || statusLooksLate(trip.executionStatus) || statusLooksLate(trip.tourState);
  const runningLate =
    anyLate &&
    progress.some((p) => p.late && p.state === 'not_reached');

  if (!anyLate && !statusLate) {
    if (trip.section === 'HISTORY' || progress.every((p) => p.state === 'done')) {
      return { kind: 'on_time', label: 'On time', tooltip: 'Arrivals matched schedule (or no late signal).' };
    }
    if (progress.some((p) => p.state === 'at_stop' || p.state === 'done')) {
      return { kind: 'on_time', label: 'On time', tooltip: 'Currently on schedule.' };
    }
    return null;
  }

  if (runningLate) {
    return {
      kind: 'running_late',
      label: 'Running late',
      tooltip: reason ? `Running late — ${reason}` : 'Past schedule, not yet arrived at next stop.',
    };
  }

  if ((anyLate || statusLate) && !reason) {
    return {
      kind: 'late_no_reason',
      label: 'Late – no reason',
      tooltip: 'Late to a stop with no delay reason reported in Relay.',
    };
  }

  return {
    kind: 'late',
    label: 'Late',
    tooltip: reason ? `Late — ${reason}` : 'Late versus scheduled arrival.',
  };
}

export function isTripLate(trip: RelayTrip, now = Date.now()): boolean {
  const chip = deriveTimingChip(trip, now);
  return Boolean(chip && chip.kind !== 'on_time');
}

export function needsAttention(trip: RelayTrip, now = Date.now()): boolean {
  const chip = deriveTimingChip(trip, now);
  if (chip?.kind === 'late_no_reason' || chip?.kind === 'running_late') return true;
  if (!tripDriverName(trip)) return true;
  if (!tripTractorId(trip)) return true;
  return false;
}

export function plainEnglishStatus(trip: RelayTrip, now = Date.now()): string {
  const stops = allStops(trip);
  const progress = buildStopProgress(trip, now);
  if (!stops.length) {
    return trip.status || trip.executionStatus || trip.tourState || 'No stop details yet';
  }

  if (trip.section === 'HISTORY' || progress.every((p) => p.state === 'done')) {
    const last = stops[stops.length - 1];
    return `Completed at ${last.facilityCode || 'final stop'}`;
  }

  const atIdx = progress.findIndex((p) => p.state === 'at_stop');
  if (atIdx >= 0) {
    const cur = progress[atIdx];
    const code = cur.stop.facilityCode || `stop ${cur.stop.seq ?? atIdx + 1}`;
    if (cur.late) {
      const reason = tripLateReason(trip);
      return reason
        ? `At ${code} — late (${reason})`
        : `At ${code} — late, no reason reported`;
    }
    return `At ${code} · waiting to depart`;
  }

  const nextIdx = progress.findIndex((p) => p.state === 'not_reached');
  const lastDoneIdx = [...progress].map((p, i) => ({ p, i })).reverse().find(({ p }) => p.state === 'done')?.i;

  if (nextIdx >= 0) {
    const next = progress[nextIdx];
    const nextCode = next.stop.facilityCode || `stop ${next.stop.seq ?? nextIdx + 1}`;
    if (lastDoneIdx != null) {
      const from = progress[lastDoneIdx].stop.facilityCode || 'last stop';
      if (next.late) {
        const reason = tripLateReason(trip);
        return reason
          ? `Departed ${from} · running late to ${nextCode} (${reason})`
          : `Departed ${from} · running late to ${nextCode}`;
      }
      return `Departed ${from} · en route to ${nextCode}`;
    }
    if (next.late) {
      return `Running late to ${nextCode}`;
    }
    if (trip.section === 'UPCOMING') {
      const when = formatLocalStopTime(
        next.stop.scheduledArrival,
        next.stop.timeZone,
        next.stop.scheduledArrivalLocal,
      );
      return `Scheduled · first stop ${nextCode} ${when !== '—' ? `· ${when}` : ''}`.trim();
    }
    return `En route to ${nextCode}`;
  }

  return trip.status || 'In progress';
}

export function displayStatusLabel(trip: RelayTrip): string {
  const raw = trip.executionStatus || trip.tourState || trip.status || '';
  if (!raw) {
    if (trip.section === 'HISTORY') return 'Completed';
    if (trip.section === 'UPCOMING') return 'Booked';
    if (trip.section === 'IN_TRANSIT') return 'In Transit';
    return 'Unknown';
  }
  const u = raw.toUpperCase().replace(/-/g, '_');
  const map: Record<string, string> = {
    IN_TRANSIT: 'In Transit',
    INTRANSIT: 'In Transit',
    COMPLETED: 'Completed',
    COMPLETE: 'Completed',
    CANCELLED: 'Cancelled',
    CANCELED: 'Cancelled',
    BOOKED: 'Booked',
    DISPATCHED: 'Dispatched',
    DELIVERED: 'Delivered',
    AVAILABLE: 'Available',
    PLANNED: 'Booked',
    ACTIVE: 'In Transit',
  };
  if (map[u]) return map[u];
  return raw
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function leftBorderClass(trip: RelayTrip, now = Date.now()): string {
  const chip = deriveTimingChip(trip, now);
  if (chip?.kind === 'late_no_reason' || chip?.kind === 'late') return 'border-l-danger';
  if (chip?.kind === 'running_late') return 'border-l-warning';
  const label = displayStatusLabel(trip);
  if (label === 'Completed' || label === 'Delivered') return 'border-l-success';
  if (label === 'Cancelled' || label === 'Rejected') return 'border-l-slate-400';
  if (label === 'In Transit' || label === 'Dispatched') return 'border-l-secondary';
  if (label === 'Booked' || label === 'Available') return 'border-l-violet-400';
  return 'border-l-border';
}

export function tripDurationLabel(trip: RelayTrip): string {
  const start = ms(trip.startTime);
  const end = ms(trip.endTime);
  if (start == null || end == null || end < start) return '—';
  const mins = Math.round((end - start) / 60000);
  const days = Math.floor(mins / (60 * 24));
  const hours = Math.floor((mins % (60 * 24)) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  const m = mins % 60;
  return hours > 0 ? `${hours}h ${m}m` : `${m}m`;
}

export function ratePerMile(trip: RelayTrip): number | null {
  if (trip.ratePerMile != null && Number.isFinite(trip.ratePerMile)) return trip.ratePerMile;
  const miles = trip.totalMiles;
  const pay = trip.payout;
  if (miles && pay != null && miles > 0) return Math.round((pay / miles) * 100) / 100;
  return null;
}

export function cptWarning(
  stop: RelayStop,
  leg: RelayLeg | null,
  now = Date.now(),
): string | null {
  const cpt = ms(leg?.cpt || null);
  if (cpt == null) return null;
  if (stop.actualDeparture) return null;
  const diff = cpt - now;
  if (diff < 0) return 'CPT passed — not departed';
  if (diff <= 30 * 60 * 1000) return 'CPT within 30 minutes';
  return null;
}

export function timeSourceLabel(stop: RelayStop, kind: 'arrival' | 'departure'): string {
  if (kind === 'arrival') {
    if (stop.actualArrival) return 'Actual';
    if (stop.eta) return 'ETA';
    if (stop.scheduledArrival) return 'Scheduled';
  } else {
    if (stop.actualDeparture) return 'Actual';
    if (stop.scheduledDeparture) return 'Scheduled';
  }
  return '';
}

export function legLoadTypeLabel(leg: RelayLeg): string {
  const raw = leg.raw || {};
  const candidates = [
    raw.loadType,
    raw.trailerStatus,
    raw.equipmentStatus,
    raw.operationType,
    leg.executionStatus,
  ]
    .map((v) => (v == null ? '' : String(v)))
    .filter(Boolean);
  for (const c of candidates) {
    const u = c.toUpperCase();
    if (u.includes('BOBTAIL')) return 'Bobtail';
    if (u.includes('PRELOAD')) return 'Preloaded';
    if (u.includes('DROP')) return 'Drop';
    if (u.includes('LOADED') || u.includes('LOAD')) return 'Loaded';
  }
  return '—';
}

export function searchTripHaystack(trip: RelayTrip): string {
  const parts: string[] = [
    trip.tripId,
    trip.driverNameRaw || '',
    trip.equipment || '',
    trip.status || '',
    trip.workType || '',
    trip.businessType || '',
  ];
  for (const leg of trip.legs) {
    parts.push(
      leg.loadId,
      leg.tractorId || '',
      leg.trailerId || '',
      leg.driverNameRaw || '',
      leg.facilitySequence || '',
    );
    for (const s of leg.stops) {
      parts.push(
        s.facilityCode || '',
        s.city || '',
        s.state || '',
        s.address || '',
        s.zip || '',
      );
    }
  }
  return parts.join(' ').toLowerCase();
}

export function filterTrips(
  trips: RelayTrip[],
  opts: {
    tab: TripTab;
    search: string;
    status: string;
    driver: string;
    lateOnly: boolean;
    needsAttentionOnly: boolean;
    now?: number;
  },
): RelayTrip[] {
  const now = opts.now ?? Date.now();
  const q = opts.search.trim().toLowerCase();
  return trips.filter((trip) => {
    const bucket = sectionToTab(trip.section);
    if (opts.tab !== 'all' && bucket !== opts.tab) return false;
    if (opts.status) {
      if (displayStatusLabel(trip).toLowerCase() !== opts.status.toLowerCase()) return false;
    }
    if (opts.driver) {
      if (tripDriverName(trip).toLowerCase() !== opts.driver.toLowerCase()) return false;
    }
    if (opts.lateOnly && !isTripLate(trip, now)) return false;
    if (opts.needsAttentionOnly && !needsAttention(trip, now)) return false;
    if (q && !searchTripHaystack(trip).includes(q)) return false;
    return true;
  });
}

export function tabCountsFromSnapshots(
  snapshots: RelaySectionSnapshot[],
  trips: RelayTrip[],
): Record<TripTab, number> {
  const bySection = Object.fromEntries(snapshots.map((s) => [s.section, s.totalRecords])) as Partial<
    Record<RelaySection, number>
  >;
  const live: Record<TripBucket, number> = { upcoming: 0, in_transit: 0, history: 0 };
  for (const t of trips) {
    const b = sectionToTab(t.section);
    if (b) live[b] += 1;
  }
  return {
    upcoming: bySection.UPCOMING ?? live.upcoming,
    in_transit: bySection.IN_TRANSIT ?? live.in_transit,
    history: bySection.HISTORY ?? live.history,
    all: trips.length,
  };
}

export function computeSyncHealth(
  snapshots: RelaySectionSnapshot[],
  trips: RelayTrip[],
  lastSyncRunFinishedAt: string | null,
  opts?: { now?: number; staleMs?: number },
): RelaySyncHealth {
  const now = opts?.now ?? Date.now();
  const staleMs = opts?.staleMs ?? STALE_SYNC_MS;
  const times: number[] = [];
  for (const s of snapshots) {
    const t = ms(s.syncedAt);
    if (t != null) times.push(t);
  }
  for (const trip of trips) {
    const t = ms(trip.lastSeenAt);
    if (t != null) times.push(t);
  }
  const run = ms(lastSyncRunFinishedAt);
  if (run != null) times.push(run);

  if (!times.length) {
    return {
      status: 'unknown',
      lastSyncedAt: null,
      detail: 'No Relay snapshot yet — open Relay Trips with the extension live.',
    };
  }

  const last = Math.max(...times);
  const lastSyncedAt = new Date(last).toISOString();
  const age = now - last;
  if (age > staleMs) {
    return {
      status: 'paused',
      lastSyncedAt,
      detail: 'Sync paused – log in to Relay',
    };
  }
  return {
    status: 'healthy',
    lastSyncedAt,
    detail: null,
  };
}

export function relativeSyncedLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Never synced';
  const t = ms(iso);
  if (t == null) return 'Never synced';
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return `Last synced ${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `Last synced ${min}m ago`;
  const hr = Math.round(min / 60);
  return `Last synced ${hr}h ago`;
}

export function relayTourUrl(_tripId?: string): string {
  // Relay SPA entry; trip deep-links vary — open tours board with ID on clipboard.
  return `https://relay.amazon.com/tours`;
}

export function firstAndLastStop(trip: RelayTrip): { first: RelayStop | null; last: RelayStop | null } {
  const stops = allStops(trip);
  if (!stops.length) return { first: null, last: null };
  return { first: stops[0], last: stops[stops.length - 1] };
}
