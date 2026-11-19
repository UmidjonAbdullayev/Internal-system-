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

function stopTypeRank(stop: RelayStop): number {
  const t = String(stop.stopType || '').toUpperCase();
  if (t.includes('DROP') || t.includes('DELIVER')) return 0;
  if (t.includes('PICK')) return 1;
  return 2;
}

function stopTimeKey(stop: RelayStop): number {
  const t = stop.scheduledArrival ? Date.parse(stop.scheduledArrival) : NaN;
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/**
 * Route order: seq, then (same seq = shared facility between legs) the previous leg's DROP
 * before the next leg's PICKUP, then scheduled time.
 */
export function compareStops(a: RelayStop, b: RelayStop): number {
  return (
    (a.seq ?? 0) - (b.seq ?? 0) ||
    stopTypeRank(a) - stopTypeRank(b) ||
    stopTimeKey(a) - stopTimeKey(b)
  );
}

export function allStops(trip: RelayTrip): RelayStop[] {
  const stops: RelayStop[] = [];
  for (const leg of trip.legs) {
    for (const s of leg.stops) stops.push(s);
  }
  return stops.sort(compareStops);
}

/** Legs in route order (by their first stop), not by load ID. */
export function orderedLegs(trip: RelayTrip): RelayLeg[] {
  const first = (leg: RelayLeg) => [...leg.stops].sort(compareStops)[0];
  return [...trip.legs].sort((a, b) => {
    const fa = first(a);
    const fb = first(b);
    if (!fa || !fb) return fa ? -1 : fb ? 1 : 0;
    return compareStops(fa, fb);
  });
}

export function legForStop(trip: RelayTrip, stop: RelayStop): RelayLeg | null {
  return trip.legs.find((l) => l.loadId === stop.loadId) || null;
}

export function primaryLeg(trip: RelayTrip): RelayLeg | null {
  return orderedLegs(trip)[0] || null;
}

/**
 * Every distinct driver on the trip, in route order. Legs can be run by different drivers;
 * cancelled legs only count when nothing else names a driver.
 */
export function tripDriverNames(trip: RelayTrip): string[] {
  const legs = orderedLegs(trip);
  const active = legs.filter((l) => !isLegCancelled(l));
  const pick = (ls: RelayLeg[]) => {
    const out: string[] = [];
    for (const l of ls) {
      const n = (l.driverNameRaw || '').trim();
      if (n && !out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
    }
    return out;
  };
  const names = pick(active);
  if (names.length) return names;
  const any = pick(legs);
  if (any.length) return any;
  return trip.driverNameRaw ? [trip.driverNameRaw] : [];
}

export function tripDriverName(trip: RelayTrip): string {
  return tripDriverNames(trip)[0] || '';
}

/** Driver for one leg (falls back to the trip driver). */
export function legDriverName(trip: RelayTrip, leg: RelayLeg | null): string {
  return (leg?.driverNameRaw || '').trim() || tripDriverName(trip);
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
  if (!iso || !timeZone) {
    if (localFallback) return localFallback;
  }
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
    return localFallback || '—';
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

/** Stops on cancelled legs never count toward progress / "next stop". */
export function isStopOnCancelledLeg(trip: RelayTrip, stop: RelayStop): boolean {
  const leg = legForStop(trip, stop);
  return Boolean(leg && isLegCancelled(leg));
}

export function activeStops(trip: RelayTrip): RelayStop[] {
  return allStops(trip).filter((s) => !isStopOnCancelledLeg(trip, s));
}

export function buildStopProgress(trip: RelayTrip, now = Date.now()): StopProgressNode[] {
  const stops = activeStops(trip);
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
  const stops = activeStops(trip);
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
      if (from === nextCode) {
        // Dropped one leg and picks up the next at the same facility.
        const when = formatLocalStopTime(
          next.stop.scheduledArrival,
          next.stop.timeZone,
          next.stop.scheduledArrivalLocal,
        );
        return next.late
          ? `Dropped at ${from} · next pickup here is late (due ${when})`
          : `Dropped at ${from} · next pickup here ${when}`;
      }
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

/** Single leg cancelled (execution status). */
export function isLegCancelled(leg: { executionStatus?: string | null }): boolean {
  return /cancel/.test(String(leg.executionStatus || '').toLowerCase());
}

/**
 * Fully cancelled trip: tourState cancelled OR every load cancelled.
 * One cancelled leg does not cancel the trip. Status/executionStatus alone do not.
 */
export function isTripCancelled(
  trip: Pick<RelayTrip, 'status' | 'tourState' | 'executionStatus'> & {
    legs?: { executionStatus?: string | null }[];
  },
): boolean {
  if (/cancel/.test(String(trip.tourState || '').toLowerCase())) return true;
  const legs = trip.legs || [];
  if (legs.length > 0 && legs.every(isLegCancelled)) return true;
  return false;
}

/**
 * Trip total pay = Relay tour payout.value.
 * Exclude cancelled-leg pay from a summed total only when Relay's tour payout already
 * excludes them (cancelled legs at $0 / tour matches active-leg sum). Never invent a cut.
 */
export function tripDisplayPayout(trip: RelayTrip): number | null {
  if (trip.payout != null && Number.isFinite(Number(trip.payout))) return Number(trip.payout);
  const legs = trip.legs || [];
  if (!legs.length) return null;
  const cancelPay = legs
    .filter(isLegCancelled)
    .reduce((s, l) => s + (Number(l.payout) || 0), 0);
  const sumAll = legs.reduce((s, l) => s + (Number(l.payout) || 0), 0);
  // Relay excluded cancelled → cancelled legs contribute $0; sum active (= sum all).
  if (cancelPay === 0) return sumAll > 0 ? sumAll : null;
  // Relay still priced cancelled legs — keep full sum (do not strip).
  return sumAll > 0 ? sumAll : null;
}

export function displayStatusLabel(trip: RelayTrip): string {
  if (isTripCancelled(trip)) return 'Cancelled';
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

/**
 * CPT risk only when CHECKOUT actualTime is missing AND CPT has passed.
 * (Spec: no CPT banner while still within CPT window.)
 */
export function cptWarning(
  stop: RelayStop,
  leg: RelayLeg | null,
  now = Date.now(),
): string | null {
  const cpt = ms(leg?.cpt || null);
  if (cpt == null) return null;
  if (stop.actualDeparture) return null;
  if (cpt >= now) return null;
  return 'CPT passed — not departed';
}

export function timeSourceLabel(stop: RelayStop, kind: 'arrival' | 'departure'): string {
  if (kind === 'arrival') {
    if (stop.arrivalTimeSource) return stop.arrivalTimeSource;
    if (stop.actualArrival) return 'Actual';
    if (stop.eta) return 'ETA';
    if (stop.scheduledArrival) return 'Scheduled';
  } else {
    if (stop.departureTimeSource) return stop.departureTimeSource;
    if (stop.actualDeparture) return 'Actual';
    if (stop.scheduledDeparture) return 'Scheduled';
  }
  return '';
}

/** Minutes late (positive) when actual is after scheduled; null if not computable. */
export function minutesLate(
  actualIso: string | null | undefined,
  scheduledIso: string | null | undefined,
): number | null {
  const a = ms(actualIso || null);
  const s = ms(scheduledIso || null);
  if (a == null || s == null) return null;
  const diffMin = Math.round((a - s) / 60000);
  return diffMin > 0 ? diffMin : null;
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
    /** Optional History end-time yyyy-MM-dd range (inclusive), already zoned. */
    endDateStart?: string | null;
    endDateEnd?: string | null;
    endTimeZone?: string;
    tripEndYmd?: (trip: RelayTrip) => string | null;
    /** Upcoming: include cancelled with future start (off by default). */
    showRecentlyCancelled?: boolean;
  },
): RelayTrip[] {
  const now = opts.now ?? Date.now();
  const q = opts.search.trim().toLowerCase();
  return trips.filter((trip) => {
    const bucket = sectionToTab(trip.section);
    if (opts.tab !== 'all' && bucket !== opts.tab) return false;
    // Live tabs: active (non-cancelled) only — cancelled belong in History.
    if (
      (opts.tab === 'upcoming' || opts.tab === 'in_transit') &&
      isTripCancelled(trip) &&
      !(
        opts.tab === 'upcoming' &&
        opts.showRecentlyCancelled &&
        trip.startTime &&
        Date.parse(trip.startTime) > now
      )
    ) {
      return false;
    }
    if (opts.status) {
      if (displayStatusLabel(trip).toLowerCase() !== opts.status.toLowerCase()) return false;
    }
    if (opts.driver) {
      if (tripDriverName(trip).toLowerCase() !== opts.driver.toLowerCase()) return false;
    }
    if (opts.lateOnly && !isTripLate(trip, now)) return false;
    if (opts.needsAttentionOnly && !needsAttention(trip, now)) return false;
    if (q && !searchTripHaystack(trip).includes(q)) return false;
    if (opts.tab === 'history' && (opts.endDateStart || opts.endDateEnd) && opts.tripEndYmd) {
      const ymd = opts.tripEndYmd(trip);
      if (!ymd) return false;
      if (opts.endDateStart && ymd < opts.endDateStart) return false;
      if (opts.endDateEnd && ymd > opts.endDateEnd) return false;
    }
    return true;
  });
}

export function activeFilterLabels(opts: {
  search: string;
  status: string;
  driver: string;
  lateOnly: boolean;
  needsAttentionOnly: boolean;
  datePresetActive?: boolean;
  datePresetLabel?: string;
}): string[] {
  const labels: string[] = [];
  if (opts.search.trim()) labels.push(`Search “${opts.search.trim()}”`);
  if (opts.status) labels.push(`Status: ${opts.status}`);
  if (opts.driver) labels.push(`Driver: ${opts.driver}`);
  if (opts.lateOnly) labels.push('Late only');
  if (opts.needsAttentionOnly) labels.push('Needs attention');
  if (opts.datePresetActive && opts.datePresetLabel) labels.push(`Date: ${opts.datePresetLabel}`);
  return labels;
}

export function historySummary(trips: RelayTrip[], now = Date.now()) {
  let delivered = 0;
  let cancelled = 0;
  let totalMiles = 0;
  let totalPay = 0;
  let lateStops = 0;
  let stopCount = 0;
  for (const t of trips) {
    const label = displayStatusLabel(t).toLowerCase();
    if (label.includes('cancel')) cancelled += 1;
    else if (label.includes('deliver') || label.includes('complet')) delivered += 1;
    if (t.totalMiles != null) totalMiles += Number(t.totalMiles) || 0;
    if (t.payout != null) totalPay += Number(t.payout) || 0;
    for (const stop of allStops(t)) {
      stopCount += 1;
      const sched = stop.scheduledArrival ? Date.parse(stop.scheduledArrival) : NaN;
      const actual = stop.actualArrival ? Date.parse(stop.actualArrival) : NaN;
      if (Number.isFinite(sched) && Number.isFinite(actual) && actual - sched > 15 * 60 * 1000) {
        lateStops += 1;
      } else if (isTripLate(t, now) && stop.seq === 1) {
        // counted via trip-level late when stop deltas missing — skip double-count
      }
    }
  }
  const avgPerMi = totalMiles > 0 ? totalPay / totalMiles : 0;
  const latePct = stopCount > 0 ? (lateStops / stopCount) * 100 : 0;
  return {
    trips: trips.length,
    delivered,
    cancelled,
    totalMiles,
    totalPay,
    avgPerMi,
    lateStops,
    latePct,
  };
}

/** Tab badges = CRM rows (same as list). Live tabs count active only. */
export function tabCountsFromTrips(trips: RelayTrip[]): Record<TripTab, number> {
  const counts: Record<TripTab, number> = {
    upcoming: 0,
    in_transit: 0,
    history: 0,
    all: trips.length,
  };
  for (const t of trips) {
    const b = sectionToTab(t.section);
    if (!b) continue;
    if ((b === 'upcoming' || b === 'in_transit') && isTripCancelled(t)) continue;
    counts[b] += 1;
  }
  return counts;
}

/** @deprecated Prefer tabCountsFromTrips — snapshot totals caused badge≠list vanish bug. */
export function tabCountsFromSnapshots(
  snapshots: RelaySectionSnapshot[],
  trips: RelayTrip[],
): Record<TripTab, number> {
  void snapshots;
  return tabCountsFromTrips(trips);
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

/* ------------------------------------------------------------------ */
/* Per-stop status for the expanded trip view                          */
/* ------------------------------------------------------------------ */

export type StopStatusKind =
  | 'done' //        departed
  | 'at_stop' //     arrived, not departed
  | 'next' //        driver is heading here, still on time
  | 'next_late' //   should be here by now, not arrived
  | 'upcoming' //    later stop
  | 'cancelled'; //  stop on a cancelled leg

export interface StopStatus {
  kind: StopStatusKind;
  /** Short word shown next to PICKUP / DROP. */
  label: string;
  /** One plain-English line under the stop. */
  line: string;
  /** Arrival vs schedule: 'early' | 'on_time' | 'late' (only when arrived). */
  arrivalTiming: 'early' | 'on_time' | 'late' | null;
}

/** Same ±15 min rule as the Telegram alerts. */
const STOP_GRACE_MS = 15 * 60 * 1000;

function humanMinutes(totalMin: number): string {
  const m = Math.abs(Math.round(totalMin));
  if (m >= 60 * 24) {
    const d = Math.floor(m / (60 * 24));
    const h = Math.floor((m % (60 * 24)) / 60);
    return h ? `${d}d ${h}h` : `${d}d`;
  }
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }
  return `${m} min`;
}

/** Clock time + zone only ("20:28 MST"), for one-line summaries. */
export function shortStopTime(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    const opts: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    };
    if (timeZone) opts.timeZone = timeZone;
    return new Intl.DateTimeFormat('en-US', opts).format(d).replace(/ /g, ' ');
  } catch {
    return '—';
  }
}

function dayAndTime(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    const opts: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    };
    if (timeZone) opts.timeZone = timeZone;
    return new Intl.DateTimeFormat('en-US', opts).format(d).replace(/ /g, ' ');
  } catch {
    return '—';
  }
}

function arrivalTiming(stop: RelayStop): { kind: 'early' | 'on_time' | 'late'; text: string } | null {
  const a = ms(stop.actualArrival);
  const s = ms(stop.scheduledArrival);
  if (a == null || s == null) return null;
  const diff = a - s;
  if (diff > STOP_GRACE_MS) return { kind: 'late', text: `${humanMinutes(diff / 60000)} late` };
  if (diff < -STOP_GRACE_MS) return { kind: 'early', text: `${humanMinutes(diff / 60000)} early` };
  return { kind: 'on_time', text: 'on time' };
}

/**
 * Where each stop stands right now. "Next" = the first stop not yet reached after the
 * last stop with any check-in/out (cancelled legs skipped).
 */
export function buildStopStatuses(trip: RelayTrip, now = Date.now()): Map<RelayStop, StopStatus> {
  const out = new Map<RelayStop, StopStatus>();
  const ordered = allStops(trip);
  const active = ordered.filter((s) => !isStopOnCancelledLeg(trip, s));
  let lastTouched = -1;
  active.forEach((s, i) => {
    if (s.actualArrival || s.actualDeparture) lastTouched = i;
  });
  const nextIdx = active.findIndex(
    (s, i) => i > lastTouched && !s.actualArrival && !s.actualDeparture,
  );
  const history = trip.section === 'HISTORY';

  for (const stop of ordered) {
    if (isStopOnCancelledLeg(trip, stop)) {
      out.set(stop, { kind: 'cancelled', label: 'Cancelled', line: 'Leg cancelled', arrivalTiming: null });
      continue;
    }
    const tz = stop.timeZone;
    const timing = arrivalTiming(stop);
    const i = active.indexOf(stop);

    if (stop.actualDeparture || (history && stop.actualArrival)) {
      const parts: string[] = [];
      if (stop.actualArrival) {
        parts.push(`Arrived ${shortStopTime(stop.actualArrival, tz)}${timing ? ` (${timing.text})` : ''}`);
      }
      if (stop.actualDeparture) {
        parts.push(`${parts.length ? 'departed' : 'Departed'} ${shortStopTime(stop.actualDeparture, tz)}`);
      }
      out.set(stop, {
        kind: 'done',
        label: 'Done',
        line: parts.join(' · ') || 'Completed',
        arrivalTiming: timing?.kind ?? null,
      });
      continue;
    }

    if (stop.actualArrival) {
      const since = now - (ms(stop.actualArrival) ?? now);
      const parts = [
        `At stop since ${shortStopTime(stop.actualArrival, tz)}${timing ? ` (${timing.text})` : ''}`,
      ];
      const schDep = ms(stop.scheduledDeparture);
      if (schDep != null) {
        parts.push(
          now > schDep + STOP_GRACE_MS
            ? `departure ${humanMinutes((now - schDep) / 60000)} overdue`
            : `departs ${shortStopTime(stop.scheduledDeparture, tz)}`,
        );
      }
      if (since > 0) parts.push(`there ${humanMinutes(since / 60000)}`);
      out.set(stop, { kind: 'at_stop', label: 'At stop', line: parts.join(' · '), arrivalTiming: timing?.kind ?? null });
      continue;
    }

    const sch = ms(stop.scheduledArrival);
    const eta = ms(stop.eta);
    if (!history && i === nextIdx) {
      if (sch != null && now > sch + STOP_GRACE_MS) {
        const parts = [`Not arrived · ${humanMinutes((now - sch) / 60000)} overdue`];
        parts.push(`was due ${shortStopTime(stop.scheduledArrival, tz)}`);
        if (eta != null && eta > now) parts.push(`ETA ${shortStopTime(stop.eta, tz)}`);
        out.set(stop, { kind: 'next_late', label: 'Late', line: parts.join(' · '), arrivalTiming: null });
      } else {
        const parts = [`Next stop · due ${dayAndTime(stop.scheduledArrival, tz)}`];
        if (sch != null && sch > now) parts.push(`in ${humanMinutes((sch - now) / 60000)}`);
        if (eta != null && sch != null && eta - sch > STOP_GRACE_MS) {
          parts.push(`ETA ${shortStopTime(stop.eta, tz)} (${humanMinutes((eta - sch) / 60000)} behind)`);
        }
        out.set(stop, { kind: 'next', label: 'Next', line: parts.join(' · '), arrivalTiming: null });
      }
      continue;
    }

    out.set(stop, {
      kind: 'upcoming',
      label: history ? 'No check-in' : 'Upcoming',
      line: history
        ? 'No arrival recorded in Relay'
        : `Upcoming · due ${dayAndTime(stop.scheduledArrival, tz)}`,
      arrivalTiming: null,
    });
  }
  return out;
}
