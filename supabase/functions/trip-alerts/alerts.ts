import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type AlertConfig,
  type AlertSetting,
  type OutgoingAlert,
  dispatchAlert,
} from "./send.ts";
import { formatArrivedHtml, formatNotAtStopHtml } from "./format.ts";

const MS_MIN = 60_000;
const LATE_GRACE_MS = 15 * MS_MIN;
const MAX_STOP_AGE_MS = 6 * 60 * MS_MIN;
const SYNC_FRESH_MS = 5 * MS_MIN;
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

function isCancelledTrip(trip: Record<string, unknown>): boolean {
  const status = String(trip.status || trip.execution_status || trip.tour_state || "").toUpperCase();
  return /CANCEL/.test(status);
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

type TripCtx = {
  trip: Record<string, unknown>;
  stops: Array<Record<string, unknown>>;
  crmDriverIds: string[];
  relayDriverIds: string[];
  tractor: string | null;
};

async function loadActiveTrips(sb: SupabaseClient): Promise<Map<string, TripCtx>> {
  const { data: trips } = await sb
    .from("relay_trips")
    .select(
      "trip_id, section, status, driver_name_raw, execution_status, tour_state, raw",
    )
    .eq("archived", false)
    .in("section", ["UPCOMING", "IN_TRANSIT"]);

  const map = new Map<string, TripCtx>();
  const tripIds = (trips || []).map((t) => t.trip_id);
  let stops: Array<Record<string, unknown>> = [];
  if (tripIds.length) {
    const { data: stopRows } = await sb
      .from("relay_stops")
      .select(
        "stop_id, trip_id, load_id, seq, stop_type, facility_code, city, state, time_zone, scheduled_arrival, actual_arrival, actual_departure, eta, arrival_time_source, raw, updated_at",
      )
      .in("trip_id", tripIds)
      .eq("archived", false);
    stops = stopRows || [];
  }

  for (const trip of trips || []) {
    const tripStops = stops
      .filter((s) => String(s.trip_id) === trip.trip_id)
      .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));
    const crmDriverIds = await matchCrmDriverIds(sb, trip.driver_name_raw);
    const relayDriverIds = extractRelayDriverIds(trip.raw);
    const tractor = tractorFromTripRaw(trip.raw);
    map.set(trip.trip_id, {
      trip: trip as Record<string, unknown>,
      stops: tripStops,
      crmDriverIds,
      relayDriverIds,
      tractor,
    });
  }
  return map;
}

function buildArrivedAlert(
  ctx: TripCtx,
  stop: Record<string, unknown>,
  opts: { test?: boolean; dryRun?: boolean; reason?: string; syncBasis?: string; force?: boolean },
): OutgoingAlert | null {
  const actual = stop.actual_arrival ? String(stop.actual_arrival) : null;
  if (!actual) return null;
  const planned = stop.scheduled_arrival ? String(stop.scheduled_arrival) : null;
  const tz = String(stop.time_zone || "America/Los_Angeles");
  const facility = String(stop.facility_code || stop.stop_type || "Stop");
  const loadId = String(stop.load_id || stop.trip_id);
  const stopCount = Math.max(1, ctx.stops.length);
  const seq = Number(stop.seq ?? 1);
  const trailer = trailerFromStopRaw(stop.raw, null);
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
    tractor: ctx.tractor,
    trailer,
    timeSource: stop.arrival_time_source ? String(stop.arrival_time_source) : null,
    test: opts.test,
  });
  return {
    tripId: String(stop.trip_id),
    stopId: String(stop.stop_id),
    alertType: "arrived",
    html,
    meta: {
      facility,
      actual,
      planned,
      source: stop.arrival_time_source,
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
  if (stop.actual_arrival) return null;
  const planned = stop.scheduled_arrival ? new Date(String(stop.scheduled_arrival)).getTime() : NaN;
  if (Number.isNaN(planned)) return null;
  const overdue = now - planned;
  if (overdue < LATE_GRACE_MS) return null;
  if (overdue > MAX_STOP_AGE_MS) return null;
  if (!stopIsNext(stop, ctx.stops)) return null;
  if (isCancelledTrip(ctx.trip)) return null;

  const tz = String(stop.time_zone || "America/Los_Angeles");
  const facility = String(stop.facility_code || stop.stop_type || "Stop");
  const loadId = String(stop.load_id || stop.trip_id);
  const stopCount = Math.max(1, ctx.stops.length);
  const seq = Number(stop.seq ?? 1);
  const trailer = trailerFromStopRaw(stop.raw, null);
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
    tractor: ctx.tractor,
    trailer,
    test: opts.test,
  });
  return {
    tripId: String(stop.trip_id),
    stopId: String(stop.stop_id),
    alertType: "not_at_stop",
    html,
    meta: {
      facility,
      overdue_ms: overdue,
      planned: stop.scheduled_arrival,
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
    const stop = ctx.stops.find((s) => String(s.stop_id) === String(ev.stopId || "")) ||
      ctx.stops.find((s) => s.actual_arrival);
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
  const { data: locked } = await sb.rpc("try_trip_alerts_lock");
  if (locked === false) {
    return { paused: true, reason: "advisory_lock", results: [{ status: "locked" }] };
  }

  try {
    const sync = await inTransitSyncFresh(sb);
    if (!sync.fresh && !dryRun) {
      return { paused: true, reason: "sync_stale", results: [{ status: "sync_stale", lastAt: sync.lastAt }] };
    }

    const trips = await loadActiveTrips(sb);
    const now = Date.now();
    const windowMs = (opts?.windowHours ?? 1) * 3600_000;

    for (const ctx of trips.values()) {
      if (isCancelledTrip(ctx.trip)) continue;
      const section = String(ctx.trip.section || "");

      for (const stop of ctx.stops) {
        // NOT AT STOP — once, next stop, +15m, <6h, fresh sync
        if (section === "IN_TRANSIT" || section === "UPCOMING") {
          const notAt = buildNotAtStopAlert(ctx, stop, now, {
            dryRun: dryRun || !isEnabled(config),
            reason: "cron_not_at_stop",
            syncBasis: sync.lastAt || "cron",
          });
          if (notAt) {
            // For Upcoming: only first pickup due
            if (section === "UPCOMING") {
              const firstPickup = ctx.stops.find(
                (s) => /pick/i.test(String(s.stop_type || "")) || Number(s.seq) === 1,
              );
              if (firstPickup && String(firstPickup.stop_id) !== String(stop.stop_id)) {
                continue;
              }
            }
            results.push({
              ...(await dispatchAlert(sb, botToken, config, settings, notAt)),
              alertType: "not_at_stop",
              tripId: notAt.tripId,
              stopId: notAt.stopId,
            });
          }
        }

        // Dry-run ARRIVED: stops whose actual_arrival appeared in the last ~1h window
        if (dryRun && stop.actual_arrival) {
          const updated = stop.updated_at ? new Date(String(stop.updated_at)).getTime() : NaN;
          const actual = new Date(String(stop.actual_arrival)).getTime();
          const recent =
            (!Number.isNaN(updated) && now - updated <= windowMs) ||
            (!Number.isNaN(actual) && now - actual <= windowMs);
          if (recent) {
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
    }

    return { results };
  } finally {
    await sb.rpc("release_trip_alerts_lock");
  }
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
