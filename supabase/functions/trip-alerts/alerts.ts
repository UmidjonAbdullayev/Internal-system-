import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type AlertConfig,
  type AlertSetting,
  type OutgoingAlert,
  dispatchAlert,
} from "./send.ts";
import {
  cleanInstructions,
  formatArrivedHtml,
  formatBookedHtml,
  formatCancelledHtml,
  formatNotAtStopHtml,
  formatReminderHtml,
  type RouteStop,
} from "./format.ts";

const MS_MIN = 60_000;
const LATE_GRACE_MS = 15 * MS_MIN;
const MAX_STOP_AGE_MS = 6 * 60 * MS_MIN;
const SYNC_FRESH_MS = 5 * MS_MIN;
/** Cron arrival sweep looks back this far (covers sync pauses / late YMS posts). */
const ARRIVAL_LOOKBACK_MS = 3 * 60 * MS_MIN;
/** "Pickup / drop in 30 min" reminder window. */
const REMINDER_LEAD_MS = 30 * MS_MIN;
/** BOOKED / CANCELLED look back this far (catches up after short sync gaps). */
const LIFECYCLE_LOOKBACK_MS = 6 * 60 * MS_MIN;
const ALLOWED = new Set(["arrived", "not_at_stop"]);

export type StatusEvent = {
  kind: "arrived" | "not_at_stop" | string;
  tripId: string;
  stopId?: string;
  section?: string | null;
  live?: boolean;
  source?: string | null;
  crmDriverIds?: string[];
  relayDriverIds?: string[];
};

export function extractRelayDriverIds(raw: unknown): string[] {
  const ids: string[] = [];
  const push = (v: unknown) => {
    const s = String(v || "").trim();
    if (s) ids.push(s);
  };
  if (!raw || typeof raw !== "object") return ids;
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.drivers)) {
    for (const d of obj.drivers) {
      if (d && typeof d === "object") push((d as Record<string, unknown>).id);
    }
  }
  if (Array.isArray(obj.loads)) {
    for (const load of obj.loads) {
      if (!load || typeof load !== "object") continue;
      const list = (load as Record<string, unknown>).driverList;
      if (Array.isArray(list)) {
        for (const d of list) {
          if (d && typeof d === "object") push((d as Record<string, unknown>).id);
        }
      }
    }
  }
  return [...new Set(ids)];
}

function trailerFromStopRaw(raw: unknown, loadTrailer?: string | null): string | null {
  if (raw && typeof raw === "object") {
    const details = (raw as Record<string, unknown>).trailerDetails;
    if (Array.isArray(details) && details[0] && typeof details[0] === "object") {
      const id = (details[0] as Record<string, unknown>).assetId;
      if (id) return String(id);
    }
  }
  return loadTrailer || null;
}

function tractorFromTripRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const loads = (raw as Record<string, unknown>).loads;
  if (Array.isArray(loads)) {
    for (const load of loads) {
      if (!load || typeof load !== "object") continue;
      const td = (load as Record<string, unknown>).tractorDetail;
      if (td && typeof td === "object") {
        const id = (td as Record<string, unknown>).assetId;
        if (id) return String(id);
      }
      const list = (load as Record<string, unknown>).trailerDetails;
      // also sometimes tractor at load level
      const tractor = (load as Record<string, unknown>).tractorId;
      if (tractor) return String(tractor);
    }
  }
  return null;
}

async function matchCrmDriverIds(
  sb: SupabaseClient,
  driverNameRaw: string | null | undefined,
): Promise<string[]> {
  const name = String(driverNameRaw || "").trim().toLowerCase();
  if (!name) return [];
  const { data } = await sb
    .from("drivers")
    .select("driver_id, first_name, last_name")
    .limit(200);
  const hits: string[] = [];
  for (const d of data || []) {
    const full = `${d.first_name || ""} ${d.last_name || ""}`.trim().toLowerCase();
    if (full && (full === name || name.includes(full) || full.includes(name))) {
      hits.push(String(d.driver_id));
    }
  }
  return [...new Set(hits)];
}

async function inTransitSyncFresh(sb: SupabaseClient): Promise<{ fresh: boolean; lastAt: string | null }> {
  const { data } = await sb
    .from("sync_state")
    .select("section, last_successful_sync_at, updated_at")
    .eq("section", "IN_TRANSIT")
    .maybeSingle();
  const ts = data?.last_successful_sync_at || data?.updated_at || null;
  if (!ts) {
    // fallback relay_sync_runs
    const { data: run } = await sb
      .from("relay_sync_runs")
      .select("finished_at, started_at, status")
      .in("status", ["completed", "completed_with_errors"])
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const t = run?.finished_at || run?.started_at || null;
    if (!t) return { fresh: false, lastAt: null };
    return { fresh: Date.now() - new Date(t).getTime() <= SYNC_FRESH_MS, lastAt: t };
  }
  return { fresh: Date.now() - new Date(ts).getTime() <= SYNC_FRESH_MS, lastAt: String(ts) };
}

/** Longest stretch with no Relay sync between two times (extension/computer offline). */
async function longestSyncGap(
  sb: SupabaseClient,
  fromMs: number,
  toMs: number,
): Promise<{ start: string; end: string; minutes: number } | null> {
  const { data } = await sb
    .from("relay_sync_runs")
    .select("started_at")
    .gte("started_at", new Date(fromMs).toISOString())
    .lte("started_at", new Date(toMs).toISOString())
    .order("started_at", { ascending: true })
    .limit(2000);
  const times = [fromMs, ...(data || []).map((r) => new Date(String(r.started_at)).getTime()), toMs];
  let best: { a: number; b: number } | null = null;
  for (let i = 1; i < times.length; i++) {
    const a = times[i - 1];
    const b = times[i];
    if (!best || b - a > best.b - best.a) best = { a, b };
  }
  if (!best || best.b - best.a < SYNC_FRESH_MS) return null;
  return {
    start: new Date(best.a).toISOString(),
    end: new Date(best.b).toISOString(),
    minutes: Math.round((best.b - best.a) / MS_MIN),
  };
}

function isCancelledTrip(trip: Record<string, unknown>): boolean {
  const status = String(trip.status || trip.execution_status || trip.tour_state || "").toUpperCase();
  return /CANCEL/.test(status);
}

function isCancelledStatus(status: unknown): boolean {
  return /CANCEL/.test(String(status || "").toUpperCase());
}

/** Load IDs marked CANCELLED on the trip raw payload. */
export function extractCancelledLoadIdsFromRaw(raw: unknown): Set<string> {
  const out = new Set<string>();
  if (!raw || typeof raw !== "object") return out;
  const loads = (raw as Record<string, unknown>).loads;
  if (!Array.isArray(loads)) return out;
  for (const load of loads) {
    if (!load || typeof load !== "object") continue;
    const row = load as Record<string, unknown>;
    if (!isCancelledStatus(row.executionStatus ?? row.execution_status ?? row.status)) {
      continue;
    }
    const id = row.id ?? row.loadId ?? row.load_id;
    if (id) out.add(String(id));
  }
  return out;
}

function isCancelledLoadStop(
  stop: Record<string, unknown>,
  cancelledLoadIds: Set<string>,
): boolean {
  const loadId = String(stop.load_id || "").trim();
  return Boolean(loadId) && cancelledLoadIds.has(loadId);
}

/** Alertable stops only — cancelled-load stops never participate in next-stop or sends. */
function alertableStops(ctx: TripCtx): Array<Record<string, unknown>> {
  return ctx.stops.filter((s) => !isCancelledLoadStop(s, ctx.cancelledLoadIds));
}

function stopIsNext(
  stop: Record<string, unknown>,
  allStops: Array<Record<string, unknown>>,
): boolean {
  const tripId = String(stop.trip_id);
  const seq = Number(stop.seq ?? 0);
  const later = allStops.filter(
    (s) =>
      String(s.trip_id) === tripId &&
      Number(s.seq ?? 0) > seq &&
      (s.actual_arrival || s.actual_departure),
  );
  return later.length === 0;
}

type LegInfo = {
  driver: string | null;
  tractor: string | null;
  trailer: string | null;
  status: string | null;
  payout: number | null;
};

type TripCtx = {
  trip: Record<string, unknown>;
  stops: Array<Record<string, unknown>>;
  /** Per-load driver / tractor / trailer (legs can have different drivers). */
  legs: Map<string, LegInfo>;
  cancelledLoadIds: Set<string>;
  crmDriverIds: string[];
  relayDriverIds: string[];
  tractor: string | null;
};

const TRIP_COLS =
  "trip_id, section, status, driver_name_raw, execution_status, tour_state, raw, payout, total_miles, work_type, created_at";

async function loadActiveTrips(
  sb: SupabaseClient,
  opts?: { withRecentArrivals?: boolean },
): Promise<Map<string, TripCtx>> {
  const { data: liveTrips } = await sb
    .from("relay_trips")
    .select(TRIP_COLS)
    .eq("archived", false)
    .in("section", ["UPCOMING", "IN_TRANSIT"]);
  const trips = [...(liveTrips || [])];
  // A tour's last check-in often arrives in the same sync that moves it to History,
  // so also load trips with a check-in first seen recently (arrival sweep only).
  if (opts?.withRecentArrivals) {
    const since = new Date(Date.now() - ARRIVAL_LOOKBACK_MS).toISOString();
    const { data: recent } = await sb
      .from("relay_stops")
      .select("trip_id")
      .gte("actual_arrival_first_seen_at", since)
      .eq("archived", false)
      .limit(500);
    const have = new Set(trips.map((t) => String(t.trip_id)));
    const extra = [...new Set((recent || []).map((r) => String(r.trip_id)))].filter((id) => !have.has(id));
    if (extra.length) {
      const { data: more } = await sb
        .from("relay_trips")
        .select(TRIP_COLS)
        .eq("archived", false)
        .in("trip_id", extra);
      trips.push(...(more || []));
    }
  }

  return buildTripContexts(sb, trips);
}

async function loadTripsByIds(sb: SupabaseClient, ids: string[]): Promise<Map<string, TripCtx>> {
  if (!ids.length) return new Map();
  const { data } = await sb.from("relay_trips").select(TRIP_COLS).in("trip_id", ids);
  return buildTripContexts(sb, data || []);
}

async function buildTripContexts(
  sb: SupabaseClient,
  trips: Array<Record<string, any>>,
): Promise<Map<string, TripCtx>> {
  const map = new Map<string, TripCtx>();
  const tripIds = trips.map((t) => t.trip_id);
  let stops: Array<Record<string, unknown>> = [];
  const cancelledByTrip = new Map<string, Set<string>>();
  const legsByTrip = new Map<string, Map<string, LegInfo>>();
  if (tripIds.length) {
    const { data: stopRows } = await sb
      .from("relay_stops")
      .select(
        "stop_id, trip_id, load_id, seq, stop_type, facility_code, city, state, time_zone, scheduled_arrival, actual_arrival, actual_departure, eta, arrival_time_source, raw, updated_at",
      )
      .in("trip_id", tripIds)
      .eq("archived", false);
    stops = stopRows || [];

    const { data: legRows } = await sb
      .from("relay_legs")
      .select("trip_id, load_id, execution_status, driver_name_raw, tractor_id, trailer_id, payout")
      .in("trip_id", tripIds)
      .eq("archived", false);
    for (const leg of legRows || []) {
      const tid0 = String(leg.trip_id || "");
      const lid0 = String(leg.load_id || "").trim();
      if (tid0 && lid0) {
        if (!legsByTrip.has(tid0)) legsByTrip.set(tid0, new Map());
        legsByTrip.get(tid0)!.set(lid0, {
          driver: leg.driver_name_raw ? String(leg.driver_name_raw) : null,
          tractor: leg.tractor_id ? String(leg.tractor_id) : null,
          trailer: leg.trailer_id ? String(leg.trailer_id) : null,
          status: leg.execution_status ? String(leg.execution_status) : null,
          payout: leg.payout != null && Number.isFinite(Number(leg.payout)) ? Number(leg.payout) : null,
        });
      }
      if (!isCancelledStatus(leg.execution_status)) continue;
      const tid = String(leg.trip_id || "");
      const lid = String(leg.load_id || "").trim();
      if (!tid || !lid) continue;
      if (!cancelledByTrip.has(tid)) cancelledByTrip.set(tid, new Set());
      cancelledByTrip.get(tid)!.add(lid);
    }
  }

  for (const trip of trips) {
    const tripStops = orderStops(stops.filter((s) => String(s.trip_id) === trip.trip_id));
    const cancelledLoadIds = new Set<string>([
      ...extractCancelledLoadIdsFromRaw(trip.raw),
      ...(cancelledByTrip.get(trip.trip_id) || []),
    ]);
    const crmDriverIds = await matchCrmDriverIds(sb, trip.driver_name_raw);
    const relayDriverIds = extractRelayDriverIds(trip.raw);
    const tractor = tractorFromTripRaw(trip.raw);
    map.set(trip.trip_id, {
      trip: trip as Record<string, unknown>,
      stops: tripStops,
      legs: legsByTrip.get(trip.trip_id) || new Map(),
      cancelledLoadIds,
      crmDriverIds,
      relayDriverIds,
      tractor,
    });
  }
  return map;
}

/** Seq order; at the same seq a DROP comes before the next leg's PICKUP; then scheduled time. */
export function orderStops<T extends Record<string, unknown>>(rows: T[]): T[] {
  const typeRank = (s: Record<string, unknown>) =>
    /drop|deliver/i.test(String(s.stop_type || "")) ? 0 : /pick/i.test(String(s.stop_type || "")) ? 1 : 2;
  const t = (s: Record<string, unknown>) => {
    const v = new Date(String(s.scheduled_arrival || "")).getTime();
    return Number.isNaN(v) ? Number.MAX_SAFE_INTEGER : v;
  };
  return [...rows].sort(
    (a, b) =>
      Number(a.seq ?? 0) - Number(b.seq ?? 0) ||
      typeRank(a) - typeRank(b) ||
      t(a) - t(b),
  );
}

/** Driver / tractor / trailer for the leg this stop belongs to (falls back to trip level). */
function stopPeople(ctx: TripCtx, stop: Record<string, unknown>) {
  const leg = ctx.legs.get(String(stop.load_id || "").trim());
  const tripDriver = ctx.trip.driver_name_raw ? String(ctx.trip.driver_name_raw) : null;
  return {
    driver: leg?.driver || tripDriver,
    tractor: leg?.tractor || ctx.tractor,
    trailer: trailerFromStopRaw(stop.raw, leg?.trailer || null),
  };
}

/** 1-based position of the stop among alertable stops (seq can repeat across legs). */
function stopPosition(ctx: TripCtx, stop: Record<string, unknown>): { pos: number; count: number } {
  const eligible = alertableStops(ctx);
  const idx = eligible.findIndex((s) => String(s.stop_id) === String(stop.stop_id));
  return { pos: idx >= 0 ? idx + 1 : Number(stop.seq ?? 1), count: Math.max(1, eligible.length) };
}

/** Relay pickup / delivery instructions for a stop (from the trip's raw Relay payload). */
function stopInstructions(ctx: TripCtx, stop: Record<string, unknown>): string | null {
  const loads = (ctx.trip.raw as Record<string, unknown> | null)?.loads;
  if (!Array.isArray(loads)) return null;
  const loadId = String(stop.load_id || "").trim().toUpperCase();
  const seq = Number(stop.seq ?? NaN);
  for (const load of loads as Array<Record<string, any>>) {
    const id = String(load?.versionedLoadId?.id || "").trim().toUpperCase();
    if (!id || id !== loadId) continue;
    for (const rs of (load.stops || []) as Array<Record<string, any>>) {
      if (Number(rs?.stopSequenceNumber) !== seq) continue;
      const isDrop = /drop|deliver/i.test(String(stop.stop_type || rs?.stopType || ""));
      return cleanInstructions(isDrop ? rs?.deliveryInstructions : rs?.pickupInstructions);
    }
  }
  return null;
}

function routeOf(stops: Array<Record<string, unknown>>): RouteStop[] {
  return stops.map((s) => ({
    facility: String(s.facility_code || s.stop_type || "Stop"),
    city: s.city ? String(s.city) : null,
    state: s.state ? String(s.state) : null,
    stopType: s.stop_type ? String(s.stop_type) : null,
    scheduledAt: s.scheduled_arrival ? String(s.scheduled_arrival) : null,
    timeZone: String(s.time_zone || "America/Los_Angeles"),
  }));
}

function buildArrivedAlert(
  ctx: TripCtx,
  stop: Record<string, unknown>,
  opts: {
    test?: boolean;
    dryRun?: boolean;
    reason?: string;
    syncBasis?: string;
    force?: boolean;
    reportedAfterMinutes?: number | null;
    syncGap?: { start: string; end: string; minutes: number } | null;
  },
): OutgoingAlert | null {
  if (isCancelledLoadStop(stop, ctx.cancelledLoadIds)) return null;
  const actual = stop.actual_arrival ? String(stop.actual_arrival) : null;
  if (!actual) return null;
  const planned = stop.scheduled_arrival ? String(stop.scheduled_arrival) : null;
  const tz = String(stop.time_zone || "America/Los_Angeles");
  const facility = String(stop.facility_code || stop.stop_type || "Stop");
  const loadId = String(stop.load_id || stop.trip_id);
  const { pos: seq, count: stopCount } = stopPosition(ctx, stop);
  const people = stopPeople(ctx, stop);
  const trailer = people.trailer;
  const driverName = people.driver;
  const html = formatArrivedHtml({
    facility,
    city: stop.city ? String(stop.city) : null,
    state: stop.state ? String(stop.state) : null,
    tripId: String(stop.trip_id),
    loadId,
    stopSeq: seq,
    stopCount,
    stopType: stop.stop_type ? String(stop.stop_type) : null,
    actualAt: actual,
    plannedAt: planned,
    timeZone: tz,
    tractor: people.tractor,
    trailer,
    timeSource: stop.arrival_time_source ? String(stop.arrival_time_source) : null,
    driver: driverName,
    reportedAfterMinutes: opts.reportedAfterMinutes ?? null,
    syncGap: opts.syncGap ?? null,
    instructions: opts.test ? null : stopInstructions(ctx, stop),
    test: opts.test,
  });
  return {
    tripId: String(stop.trip_id),
    stopId: String(stop.stop_id),
    alertType: "arrived",
    html,
    meta: {
      facility,
      city: stop.city || null,
      state: stop.state || null,
      actual,
      planned,
      source: stop.arrival_time_source,
      driver: driverName,
      tractor: people.tractor,
      trailer: trailer || "Bobtail",
      stop_seq: seq,
      stop_type: stop.stop_type || null,
    },
    dryRun: opts.dryRun,
    force: opts.force,
    reason: opts.reason,
    syncBasis: opts.syncBasis,
    crmDriverIds: ctx.crmDriverIds,
    relayDriverIds: ctx.relayDriverIds,
    replyToStopAlert: true,
  };
}

function buildNotAtStopAlert(
  ctx: TripCtx,
  stop: Record<string, unknown>,
  now: number,
  opts: { test?: boolean; dryRun?: boolean; reason?: string; syncBasis?: string; force?: boolean },
): OutgoingAlert | null {
  if (isCancelledLoadStop(stop, ctx.cancelledLoadIds)) return null;
  if (stop.actual_arrival) return null;
  const planned = stop.scheduled_arrival ? new Date(String(stop.scheduled_arrival)).getTime() : NaN;
  if (Number.isNaN(planned)) return null;
  const overdue = now - planned;
  if (overdue < LATE_GRACE_MS) return null;
  if (overdue > MAX_STOP_AGE_MS) return null;
  const eligible = alertableStops(ctx);
  if (!stopIsNext(stop, eligible)) return null;
  if (isCancelledTrip(ctx.trip)) return null;

  const tz = String(stop.time_zone || "America/Los_Angeles");
  const facility = String(stop.facility_code || stop.stop_type || "Stop");
  const loadId = String(stop.load_id || stop.trip_id);
  const { pos: seq, count: stopCount } = stopPosition(ctx, stop);
  const people = stopPeople(ctx, stop);
  const trailer = people.trailer;
  const driverName = people.driver;
  const html = formatNotAtStopHtml({
    facility,
    city: stop.city ? String(stop.city) : null,
    state: stop.state ? String(stop.state) : null,
    tripId: String(stop.trip_id),
    loadId,
    stopSeq: seq,
    stopCount,
    stopType: stop.stop_type ? String(stop.stop_type) : null,
    plannedAt: String(stop.scheduled_arrival),
    overdueMinutes: Math.round(overdue / MS_MIN),
    timeZone: tz,
    eta: stop.eta ? String(stop.eta) : null,
    tractor: people.tractor,
    trailer,
    driver: driverName,
    test: opts.test,
  });
  return {
    tripId: String(stop.trip_id),
    stopId: String(stop.stop_id),
    alertType: "not_at_stop",
    html,
    meta: {
      facility,
      city: stop.city || null,
      state: stop.state || null,
      overdue_ms: overdue,
      planned: stop.scheduled_arrival,
      actual: null,
      eta: stop.eta || null,
      driver: driverName,
      tractor: people.tractor,
      trailer: trailer || "Bobtail",
      stop_seq: seq,
      stop_type: stop.stop_type || null,
    },
    dryRun: opts.dryRun,
    force: opts.force,
    reason: opts.reason,
    syncBasis: opts.syncBasis,
    crmDriverIds: ctx.crmDriverIds,
    relayDriverIds: ctx.relayDriverIds,
  };
}

export async function processStatusEvents(
  sb: SupabaseClient,
  botToken: string,
  config: AlertConfig,
  settings: Map<string, AlertSetting>,
  events: StatusEvent[],
  opts?: { dryRun?: boolean },
): Promise<unknown[]> {
  const results: unknown[] = [];
  const dryRun = Boolean(opts?.dryRun) || !config.alerts_enabled;
  // Only live arrived edges from consecutive syncs
  for (const ev of events) {
    if (!ALLOWED.has(ev.kind)) {
      results.push({ alertType: ev.kind, status: "removed_alert_type" });
      continue;
    }
    if (ev.kind !== "arrived") continue;
    if (!ev.live) {
      results.push({ alertType: "arrived", tripId: ev.tripId, status: "skipped_not_live" });
      continue;
    }
    if (ev.source && /backfill|catchup|force|history|migrate|test/i.test(ev.source)) {
      results.push({ alertType: "arrived", tripId: ev.tripId, status: "skipped_source", source: ev.source });
      continue;
    }
    const trips = await loadActiveTrips(sb);
    const ctx = trips.get(ev.tripId);
    if (!ctx) {
      results.push({ alertType: "arrived", tripId: ev.tripId, status: "trip_not_active" });
      continue;
    }
    const eligible = alertableStops(ctx);
    const stop = eligible.find((s) => String(s.stop_id) === String(ev.stopId || "")) ||
      eligible.find((s) => s.actual_arrival);
    if (ev.stopId && ctx.stops.some((s) => String(s.stop_id) === String(ev.stopId)) &&
      !eligible.some((s) => String(s.stop_id) === String(ev.stopId))) {
      results.push({
        alertType: "arrived",
        tripId: ev.tripId,
        stopId: ev.stopId,
        status: "skipped_cancelled_load",
      });
      continue;
    }
    if (!stop?.actual_arrival) {
      results.push({ alertType: "arrived", tripId: ev.tripId, status: "no_actual" });
      continue;
    }
    const alert = buildArrivedAlert(ctx, stop, {
      dryRun,
      reason: "live_checkin_edge",
      syncBasis: "status_event",
    });
    if (!alert) continue;
    if (ev.crmDriverIds?.length) alert.crmDriverIds = ev.crmDriverIds;
    if (ev.relayDriverIds?.length) alert.relayDriverIds = ev.relayDriverIds;
    results.push({
      ...(await dispatchAlert(sb, botToken, config, settings, alert)),
      alertType: "arrived",
      tripId: ev.tripId,
      stopId: stop.stop_id,
    });
  }
  return results;
}

export async function runCronChecks(
  sb: SupabaseClient,
  botToken: string,
  config: AlertConfig,
  settings: Map<string, AlertSetting>,
  opts?: { dryRun?: boolean; windowHours?: number },
): Promise<{ paused?: boolean; reason?: string; results: unknown[] }> {
  const results: unknown[] = [];
  const dryRun = Boolean(opts?.dryRun);
  // Advisory lock only for live cron sends — dry-run skips (pooler can stick session locks)
  let holdLock = false;
  if (!dryRun) {
    const { data: locked } = await sb.rpc("try_trip_alerts_lock");
    if (locked === false) {
      return { paused: true, reason: "advisory_lock", results: [{ status: "locked" }] };
    }
    holdLock = true;
  }

  try {
    const sync = await inTransitSyncFresh(sb);
    if (!sync.fresh && !dryRun) {
      return { paused: true, reason: "sync_stale", results: [{ status: "sync_stale", lastAt: sync.lastAt }] };
    }

    const trips = await loadActiveTrips(sb, { withRecentArrivals: !dryRun });
    const now = Date.now();
    const windowMs = (opts?.windowHours ?? 1) * 3600_000;

    for (const ctx of trips.values()) {
      if (isCancelledTrip(ctx.trip)) continue;
      const section = String(ctx.trip.section || "");

      // NOT AT STOP — at most one next-stop per trip (earliest overdue eligible).
      // Cancelled-load stops are excluded from alertableStops / buildNotAtStopAlert.
      if (section === "IN_TRANSIT" || section === "UPCOMING") {
        const eligible = alertableStops(ctx);
        const candidates: OutgoingAlert[] = [];
        for (const stop of eligible) {
          if (section === "UPCOMING") {
            const firstPickup = eligible.find(
              (s) => /pick/i.test(String(s.stop_type || "")) || Number(s.seq) === 1,
            );
            if (firstPickup && String(firstPickup.stop_id) !== String(stop.stop_id)) {
              continue;
            }
          }
          const notAt = buildNotAtStopAlert(ctx, stop, now, {
            dryRun: dryRun || !isEnabled(config),
            reason: "cron_not_at_stop",
            syncBasis: sync.lastAt || "cron",
          });
          if (notAt) candidates.push(notAt);
        }
        candidates.sort((a, b) => {
          const pa = new Date(String(a.meta?.planned || 0)).getTime();
          const pb = new Date(String(b.meta?.planned || 0)).getTime();
          return pa - pb;
        });
        const nextOnly = candidates[0];
        if (nextOnly) {
          results.push({
            ...(await dispatchAlert(sb, botToken, config, settings, nextOnly)),
            alertType: "not_at_stop",
            tripId: nextOnly.tripId,
            stopId: nextOnly.stopId,
          });
        }
      }

      // REMINDER: pickup / drop-off due within 30 min and no check-in yet (live trips).
      if (!dryRun && isEnabled(config) && (section === "IN_TRANSIT" || section === "UPCOMING")) {
        const since = config.lifecycle_alerts_since ? new Date(config.lifecycle_alerts_since).getTime() : NaN;
        if (!Number.isNaN(since)) {
          const eligible = alertableStops(ctx);
          for (const stop of eligible) {
            if (stop.actual_arrival || stop.actual_departure) continue;
            const planned = stop.scheduled_arrival ? new Date(String(stop.scheduled_arrival)).getTime() : NaN;
            if (Number.isNaN(planned) || planned <= now || planned - now > REMINDER_LEAD_MS) continue;
            if (planned - REMINDER_LEAD_MS < since) continue; // window opened before alerts were on
            if (!stopIsNext(stop, eligible)) continue; // a later stop already checked in
            const people = stopPeople(ctx, stop);
            const { pos, count } = stopPosition(ctx, stop);
            const tz = String(stop.time_zone || "America/Los_Angeles");
            const html = formatReminderHtml({
              driver: people.driver,
              facility: String(stop.facility_code || stop.stop_type || "Stop"),
              city: stop.city ? String(stop.city) : null,
              state: stop.state ? String(stop.state) : null,
              tripId: String(stop.trip_id),
              loadId: String(stop.load_id || stop.trip_id),
              stopSeq: pos,
              stopCount: count,
              stopType: stop.stop_type ? String(stop.stop_type) : null,
              plannedAt: String(stop.scheduled_arrival),
              minutesLeft: Math.max(1, Math.round((planned - now) / MS_MIN)),
              timeZone: tz,
              eta: stop.eta ? String(stop.eta) : null,
              tractor: people.tractor,
              trailer: people.trailer,
            });
            const out = await dispatchAlert(sb, botToken, config, settings, {
              tripId: String(stop.trip_id),
              stopId: String(stop.stop_id),
              alertType: "reminder",
              html,
              meta: { driver: people.driver, facility: stop.facility_code, planned: stop.scheduled_arrival },
              reason: "cron_reminder_30m",
              syncBasis: sync.lastAt || "cron",
              crmDriverIds: ctx.crmDriverIds,
              relayDriverIds: ctx.relayDriverIds,
            });
            if (out.status !== "deduped") {
              results.push({ ...out, alertType: "reminder", tripId: stop.trip_id, stopId: stop.stop_id });
            }
          }
        }
      }

      // ARRIVED sweep (live): trips sync through relay-snapshot, which sends no arrival
      // events, so new check-ins are found here. alerts_sent dedupes (one per stop/chat).
      // Only check-ins after arrival_alerts_since and within the look-back window.
      if (!dryRun && isEnabled(config)) {
        const sinceCfg = config.arrival_alerts_since ? new Date(config.arrival_alerts_since).getTime() : NaN;
        const cutoff = Math.max(now - ARRIVAL_LOOKBACK_MS, Number.isNaN(sinceCfg) ? now - ARRIVAL_LOOKBACK_MS : sinceCfg);
        for (const stop of alertableStops(ctx)) {
          if (!stop.actual_arrival) continue;
          const actual = new Date(String(stop.actual_arrival)).getTime();
          if (Number.isNaN(actual) || actual < cutoff || actual > now + 5 * MS_MIN) continue;
          const lagMin = Math.round((now - actual) / MS_MIN);
          // Late send: was our sync offline (computer asleep) or did Relay post it late?
          const syncGap = lagMin >= 10 ? await longestSyncGap(sb, actual, now) : null;
          const arrived = buildArrivedAlert(ctx, stop, {
            reason: syncGap ? "cron_arrival_sweep_after_sync_gap" : "cron_arrival_sweep",
            syncBasis: sync.lastAt || "cron",
            reportedAfterMinutes: lagMin,
            syncGap,
          });
          if (!arrived) continue;
          const out = await dispatchAlert(sb, botToken, config, settings, arrived);
          if (out.status !== "deduped") {
            results.push({ ...out, alertType: "arrived", tripId: arrived.tripId, stopId: arrived.stopId });
          }
        }
      }

      // Dry-run ARRIVED: actual_arrival timestamp within the last ~1h only
      // (do not use updated_at — remaps/re-syncs would inflate the preview)
      if (dryRun) {
        for (const stop of alertableStops(ctx)) {
          if (!stop.actual_arrival) continue;
          const actual = new Date(String(stop.actual_arrival)).getTime();
          const recent = !Number.isNaN(actual) && now - actual <= windowMs && actual <= now;
          if (!recent) continue;
          const arrived = buildArrivedAlert(ctx, stop, {
            dryRun: true,
            reason: "dry_run_recent_arrival",
            syncBasis: `window_${opts?.windowHours ?? 1}h`,
          });
          if (arrived) {
            results.push({
              ...(await dispatchAlert(sb, botToken, config, settings, arrived)),
              alertType: "arrived",
              tripId: arrived.tripId,
              stopId: arrived.stopId,
            });
          }
        }
      }
    }

    if (!dryRun && isEnabled(config)) {
      results.push(...(await runLifecycleAlerts(sb, botToken, config, settings, trips, sync.lastAt)));
    }

    return { results };
  } finally {
    if (holdLock) await sb.rpc("release_trip_alerts_lock");
  }
}

/** BOOKED (new live trip) and CANCELLED (whole trip or one leg) — once each, via alerts_sent. */
async function runLifecycleAlerts(
  sb: SupabaseClient,
  botToken: string,
  config: AlertConfig,
  settings: Map<string, AlertSetting>,
  liveTrips: Map<string, TripCtx>,
  syncBasis: string | null,
): Promise<unknown[]> {
  const results: unknown[] = [];
  const since = config.lifecycle_alerts_since ? new Date(config.lifecycle_alerts_since).getTime() : NaN;
  if (Number.isNaN(since)) return results;
  const cutoffIso = new Date(Math.max(since, Date.now() - LIFECYCLE_LOOKBACK_MS)).toISOString();

  // BOOKED: trips first seen (created) recently that are on Upcoming / In Transit.
  for (const ctx of liveTrips.values()) {
    const created = ctx.trip.created_at ? String(ctx.trip.created_at) : null;
    if (!created || created < cutoffIso) continue;
    const section = String(ctx.trip.section || "");
    if (section !== "UPCOMING" && section !== "IN_TRANSIT") continue;
    if (isCancelledTrip(ctx.trip)) continue;
    const active = alertableStops(ctx);
    if (!active.length) continue;
    const legIds = new Set(active.map((s) => String(s.load_id || "")));
    const drivers = [
      ...new Set(
        [...legIds]
          .map((id) => ctx.legs.get(id)?.driver)
          .concat(ctx.trip.driver_name_raw ? [String(ctx.trip.driver_name_raw)] : [])
          .filter((d): d is string => Boolean(d && String(d).trim())),
      ),
    ];
    const html = formatBookedHtml({
      tripId: String(ctx.trip.trip_id),
      stops: routeOf(active),
      stopCount: active.length,
      legCount: legIds.size,
      miles: ctx.trip.total_miles != null ? Number(ctx.trip.total_miles) : null,
      payout: ctx.trip.payout != null ? Number(ctx.trip.payout) : null,
      drivers,
      workType: ctx.trip.work_type ? String(ctx.trip.work_type) : null,
    });
    const out = await dispatchAlert(sb, botToken, config, settings, {
      tripId: String(ctx.trip.trip_id),
      stopId: "trip",
      alertType: "trip_booked",
      html,
      meta: { driver: drivers[0] || null, payout: ctx.trip.payout ?? null },
      reason: "cron_booked",
      syncBasis: syncBasis || "cron",
      crmDriverIds: ctx.crmDriverIds,
      relayDriverIds: ctx.relayDriverIds,
    });
    if (out.status !== "deduped") results.push({ ...out, alertType: "trip_booked", tripId: ctx.trip.trip_id });
  }

  // CANCELLED: legs whose status changed to CANCELLED recently (DB trigger stamps the time).
  const { data: cancelledLegs } = await sb
    .from("relay_legs")
    .select("trip_id, load_id")
    .gte("cancelled_first_seen_at", cutoffIso)
    .eq("archived", false)
    .limit(200);
  const byTrip = new Map<string, string[]>();
  for (const l of cancelledLegs || []) {
    const t = String(l.trip_id);
    byTrip.set(t, [...(byTrip.get(t) || []), String(l.load_id).toUpperCase()]);
  }
  if (!byTrip.size) return results;
  const ctxs = await loadTripsByIds(sb, [...byTrip.keys()]);
  for (const [tripId, loadIds] of byTrip) {
    const ctx = ctxs.get(tripId);
    if (!ctx) continue;
    const allLegs = [...ctx.legs.entries()];
    const stillActive = allLegs.filter(([, l]) => !isCancelledStatus(l.status));
    const wholeTrip = allLegs.length > 0 && stillActive.length === 0;
    const targets: Array<string | null> = wholeTrip ? [null] : loadIds;
    for (const loadId of targets) {
      const stops = ctx.stops.filter((s) => !loadId || String(s.load_id || "").toUpperCase() === loadId);
      const leg = loadId ? ctx.legs.get(loadId) : null;
      const driver = leg?.driver || (ctx.trip.driver_name_raw ? String(ctx.trip.driver_name_raw) : null);
      const html = formatCancelledHtml({
        tripId,
        loadId,
        stops: routeOf(stops),
        driver,
        payout: loadId ? leg?.payout ?? null : ctx.trip.payout != null ? Number(ctx.trip.payout) : null,
        remainingLegs: loadId ? stillActive.length : 0,
      });
      const out = await dispatchAlert(sb, botToken, config, settings, {
        tripId,
        stopId: loadId ? `leg:${loadId}` : "trip",
        alertType: "cancelled",
        html,
        meta: { driver, load_id: loadId },
        reason: wholeTrip ? "cron_trip_cancelled" : "cron_leg_cancelled",
        syncBasis: syncBasis || "cron",
        crmDriverIds: ctx.crmDriverIds,
        relayDriverIds: ctx.relayDriverIds,
      });
      if (out.status !== "deduped") results.push({ ...out, alertType: "cancelled", tripId, loadId });
    }
  }
  return results;
}

function isEnabled(config: AlertConfig): boolean {
  const v = (Deno.env.get("TELEGRAM_ALERTS_ENABLED") || "").trim().toLowerCase();
  return (v === "1" || v === "true" || v === "yes" || v === "on") && config.alerts_enabled !== false;
}

export async function sendAllTestAlerts(
  sb: SupabaseClient,
  botToken: string,
  config: AlertConfig,
  settings: Map<string, AlertSetting>,
  opts?: { chatIds?: string[] },
): Promise<unknown[]> {
  const chatIds = opts?.chatIds;
  const sampleArrived = formatArrivedHtml({
    facility: "KRB1",
    city: "San Bernardino",
    state: "CA",
    tripId: "T-TESTARRIVE",
    loadId: "TESTLOAD1",
    stopSeq: 2,
    stopCount: 3,
    stopType: "Pickup",
    actualAt: new Date().toISOString(),
    plannedAt: new Date(Date.now() - 37 * MS_MIN).toISOString(),
    timeZone: "America/Los_Angeles",
    tractor: "PXG8590",
    trailer: "ST510031",
    timeSource: "YMS",
    driver: "Sample Driver",
    test: true,
  });
  const sampleNotAt = formatNotAtStopHtml({
    facility: "LAX5",
    city: "Buena Park",
    state: "CA",
    tripId: "T-TESTNOTAT",
    loadId: "TESTLOAD2",
    stopSeq: 2,
    stopCount: 2,
    stopType: "Drop",
    plannedAt: new Date(Date.now() - 25 * MS_MIN).toISOString(),
    overdueMinutes: 25,
    timeZone: "America/Los_Angeles",
    eta: new Date(Date.now() + 20 * MS_MIN).toISOString(),
    tractor: "PXG7943",
    trailer: "SV2200891",
    driver: "Sample Driver",
    test: true,
  });

  const results = [];
  for (const alert of [
    {
      tripId: "T-TESTARRIVE",
      stopId: "test:arrived",
      alertType: "arrived",
      html: sampleArrived,
      force: true,
      chatIds,
      meta: { test: true },
    },
    {
      tripId: "T-TESTNOTAT",
      stopId: "test:not_at_stop",
      alertType: "not_at_stop",
      html: sampleNotAt,
      force: true,
      chatIds,
      meta: { test: true },
    },
  ] as OutgoingAlert[]) {
    results.push(await dispatchAlert(sb, botToken, config, settings, alert));
  }
  return results;
}

/** Evaluate ~1h of would-send logic into dry_run_alerts (never sends). */
export async function runDryRunWindow(
  sb: SupabaseClient,
  botToken: string,
  config: AlertConfig,
  settings: Map<string, AlertSetting>,
  windowHours = 1,
): Promise<{ results: unknown[]; count: number }> {
  const out = await runCronChecks(sb, botToken, config, settings, {
    dryRun: true,
    windowHours,
  });
  return { results: out.results, count: out.results.length };
}
