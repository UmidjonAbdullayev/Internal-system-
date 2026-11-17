import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type AlertConfig,
  type AlertSetting,
  type OutgoingAlert,
  dispatchAlert,
} from "./send.ts";

const MS_MIN = 60_000;
const LATE_GRACE_MS = 15 * MS_MIN;
const NO_DRIVER_HORIZON_MS = 12 * 60 * MS_MIN;
const CPT_RISK_MS = 20 * MS_MIN;
const LATE_REASON_WAIT_MS = 30 * MS_MIN;
const ETA_RESLIP_MS = 30 * MS_MIN;
const SYNC_STALE_MS = 5 * MS_MIN;

export type StatusEvent = {
  kind:
    | "trip_booked"
    | "arrived"
    | "departed"
    | "delivered"
    | "cancelled"
    | "driver_changed"
    | "no_driver"
    | "late_reason";
  tripId: string;
  stopId?: string;
  section?: string | null;
  driver?: string | null;
  prevDriver?: string | null;
  scheduledAt?: string | null;
  actualAt?: string | null;
  nextStopLabel?: string | null;
  nextStopDue?: string | null;
  lateReason?: string | null;
  facility?: string | null;
  startTime?: string | null;
  timing?: "late" | "early" | "on_time" | null;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function boldTrip(tripId: string): string {
  return `<b>${esc(tripId)}</b>`;
}

export function formatLocal(
  iso: string | null | undefined,
  timeZone: string,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(String(iso)).slice(0, 32);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
    return `${get("month")} ${get("day")} ${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
  } catch {
    return d.toISOString();
  }
}

function minutesDelta(actualIso: string, scheduledIso: string): number | null {
  const a = new Date(actualIso).getTime();
  const s = new Date(scheduledIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(s)) return null;
  return Math.round((a - s) / MS_MIN);
}

export function timingLabel(
  actualIso?: string | null,
  scheduledIso?: string | null,
): "late" | "early" | "on_time" | null {
  if (!actualIso || !scheduledIso) return null;
  const mins = minutesDelta(actualIso, scheduledIso);
  if (mins == null) return null;
  if (mins > 15) return "late";
  if (mins < -15) return "early";
  return "on_time";
}

export function buildStatusHtml(ev: StatusEvent, tz: string): { html: string; level: string } {
  const trip = boldTrip(ev.tripId);
  switch (ev.kind) {
    case "trip_booked":
      return {
        level: "0",
        html: `📦 New trip ${trip}\n${esc(ev.driver || "No driver")} · Upcoming\nBooked just now`,
      };
    case "arrived": {
      const t = ev.timing || timingLabel(ev.actualAt, ev.scheduledAt) || "on_time";
      const word = t === "late" ? "late" : t === "early" ? "early" : "on time";
      return {
        level: t,
        html: `📍 Arrived ${trip} (${word})\n${esc(ev.facility || "Stop")} · ${formatLocal(ev.actualAt, tz)}\nSch ${formatLocal(ev.scheduledAt, tz)}`,
      };
    }
    case "departed":
      return {
        level: "0",
        html: `🚚 Departed ${trip}\nNext: ${esc(ev.nextStopLabel || "—")}\nDue ${formatLocal(ev.nextStopDue, tz)}`,
      };
    case "delivered":
      return {
        level: "0",
        html: `✅ Delivered ${trip}\n${esc(ev.driver || "—")}\nCompleted`,
      };
    case "cancelled":
      return {
        level: "0",
        html: `❌ Cancelled ${trip}\n${esc(ev.driver || "—")}\nTrip/leg cancelled`,
      };
    case "driver_changed":
      return {
        level: "0",
        html: `🔄 Driver change ${trip}\n${esc(ev.prevDriver || "—")} → ${esc(ev.driver || "—")}\nLive update`,
      };
    case "no_driver":
      return {
        level: "12h",
        html: `⚠️ No driver ${trip}\nStarts ${formatLocal(ev.startTime, tz)}\nAssign within 12h window`,
      };
    case "late_reason":
      return {
        level: "0",
        html: `📝 Late reason ${trip}\n${esc((ev.lateReason || "").slice(0, 120))}\nLogged`,
      };
    default:
      return { level: "0", html: `ℹ️ ${trip}` };
  }
}

export function buildTimeHtml(
  kind: "not_at_stop" | "running_late" | "cpt_risk" | "late_no_reason",
  tripId: string,
  line2: string,
  line3: string,
): string {
  const trip = boldTrip(tripId);
  const emoji =
    kind === "not_at_stop"
      ? "🚨"
      : kind === "running_late"
      ? "⏰"
      : kind === "cpt_risk"
      ? "⚡"
      : "❓";
  const title =
    kind === "not_at_stop"
      ? "Not at stop"
      : kind === "running_late"
      ? "Running late"
      : kind === "cpt_risk"
      ? "CPT risk"
      : "Late · no reason";
  return `${emoji} ${title} ${trip}\n${esc(line2)}\n${esc(line3)}`;
}

export async function processStatusEvents(
  sb: SupabaseClient,
  botToken: string,
  config: AlertConfig,
  settings: Map<string, AlertSetting>,
  events: StatusEvent[],
): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  if (!config.bootstrapped) {
    return [{ status: "bootstrap_pending", skipped: events.length }];
  }
  for (const ev of events) {
    const section = String(ev.section || "").toUpperCase();
    if (section === "HISTORY" || section === "history") {
      results.push({ tripId: ev.tripId, status: "skipped_history" });
      continue;
    }
    const built = buildStatusHtml(ev, config.timezone);
    const out: OutgoingAlert = {
      tripId: ev.tripId,
      stopId: ev.stopId,
      alertType: ev.kind,
      level: built.level,
      html: built.html,
      meta: { kind: ev.kind },
    };
    results.push({ tripId: ev.tripId, alertType: ev.kind, ...(await dispatchAlert(sb, botToken, config, settings, out)) });
  }
  return results;
}

function isActiveSection(section: string | null | undefined): boolean {
  const s = String(section || "").toUpperCase().replace(/-/g, "_");
  return s === "UPCOMING" || s === "IN_TRANSIT" || s === "INTRANSIT";
}

export async function runCronChecks(
  sb: SupabaseClient,
  botToken: string,
  config: AlertConfig,
  settings: Map<string, AlertSetting>,
): Promise<Record<string, unknown>> {
  const now = Date.now();
  const results: Array<Record<string, unknown>> = [];

  // Sync health gate
  const { data: lastRun } = await sb
    .from("relay_sync_runs")
    .select("finished_at, status, started_at")
    .in("status", ["completed", "completed_with_errors"])
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastOk = lastRun?.finished_at
    ? new Date(lastRun.finished_at).getTime()
    : lastRun?.started_at
    ? new Date(lastRun.started_at).getTime()
    : 0;
  const stale = !lastOk || now - lastOk > SYNC_STALE_MS;

  if (stale) {
    if (!config.sync_stale_notified) {
      const html =
        `🛑 Sync stopped\nNo successful Relay sync in 5m\nTime-based alerts paused`;
      const r = await dispatchAlert(sb, botToken, config, settings, {
        tripId: "SYNC",
        alertType: "sync_stopped",
        level: String(Math.floor(now / SYNC_STALE_MS)),
        html,
        force: false,
        meta: { lastOk },
      });
      results.push({ alertType: "sync_stopped", ...r });
      await sb
        .from("telegram_alert_config")
        .update({ sync_stale_notified: true, updated_at: new Date().toISOString() })
        .eq("id", 1);
    }
    return { paused: true, reason: "sync_stale", results };
  }

  if (config.sync_stale_notified) {
    const html = `🟢 Sync restored\nRelay sync is healthy again\nTime-based alerts resumed`;
    const r = await dispatchAlert(sb, botToken, config, settings, {
      tripId: "SYNC",
      alertType: "sync_restored",
      level: String(Math.floor(now / SYNC_STALE_MS)),
      html,
      meta: { lastOk },
    });
    results.push({ alertType: "sync_restored", ...r });
    await sb
      .from("telegram_alert_config")
      .update({ sync_stale_notified: false, updated_at: new Date().toISOString() })
      .eq("id", 1);
  }

  // Prefer relay_trips / relay_stops when present
  const { data: trips } = await sb
    .from("relay_trips")
    .select(
      "trip_id, section, status, driver_name_raw, start_time, execution_status, tour_state",
    )
    .eq("archived", false)
    .in("section", ["UPCOMING", "IN_TRANSIT"]);

  const tripIds = (trips || []).map((t) => t.trip_id);
  let stops: Array<Record<string, unknown>> = [];
  let legs: Array<Record<string, unknown>> = [];
  if (tripIds.length) {
    const { data: stopRows } = await sb
      .from("relay_stops")
      .select(
        "stop_id, trip_id, load_id, seq, stop_type, facility_code, scheduled_arrival, actual_arrival, scheduled_departure, actual_departure, eta, time_zone, late_reason, late_reason_at",
      )
      .in("trip_id", tripIds)
      .eq("archived", false);
    stops = stopRows || [];
    const { data: legRows } = await sb
      .from("relay_legs")
      .select("load_id, trip_id, cpt, driver_name_raw, execution_status")
      .in("trip_id", tripIds)
      .eq("archived", false);
    legs = legRows || [];
  }

  const tripById = new Map((trips || []).map((t) => [t.trip_id, t]));

  // Fallback: loads upcoming/in_transit when no relay_trips yet
  if (!trips?.length) {
    const { data: loads } = await sb
      .from("loads")
      .select(
        "load_id, parent_trip_id, trip_bucket, load_status, driver_name_raw, pickup_date, delivery_date, arrival_actual, arrival_scheduled, arrival_address, late_reason, late_reason_at, status_bar_state",
      )
      .eq("archived", false)
      .in("trip_bucket", ["upcoming", "in_transit"]);

    for (const load of loads || []) {
      const tripId = String(load.parent_trip_id || load.load_id);
      // no_driver within 12h using pickup_date as coarse start
      if (!load.driver_name_raw && load.pickup_date) {
        const start = new Date(`${load.pickup_date}T12:00:00Z`).getTime();
        if (!Number.isNaN(start) && start - now <= NO_DRIVER_HORIZON_MS && start >= now - MS_MIN) {
          const built = buildStatusHtml(
            {
              kind: "no_driver",
              tripId,
              section: load.trip_bucket,
              startTime: `${load.pickup_date}T12:00:00Z`,
            },
            config.timezone,
          );
          results.push({
            ...(await dispatchAlert(sb, botToken, config, settings, {
              tripId,
              alertType: "no_driver",
              level: built.level,
              html: built.html,
            })),
          });
        }
      }
    }
  }

  for (const stop of stops) {
    const tripId = String(stop.trip_id);
    const trip = tripById.get(tripId);
    if (!trip || !isActiveSection(trip.section)) continue;
    const stopId = String(stop.stop_id);
    const facility = String(stop.facility_code || stop.stop_type || "Stop");
    const sched = stop.scheduled_arrival ? new Date(String(stop.scheduled_arrival)).getTime() : NaN;
    const actual = stop.actual_arrival ? new Date(String(stop.actual_arrival)).getTime() : NaN;
    const eta = stop.eta ? new Date(String(stop.eta)).getTime() : NaN;
    const tz = String(stop.time_zone || config.timezone);

    // 8) NOT AT STOP
    if (!Number.isNaN(sched) && Number.isNaN(actual)) {
      const overdue = now - sched;
      for (const level of [
        { key: "15", after: LATE_GRACE_MS },
        { key: "60", after: 60 * MS_MIN },
        { key: "120", after: 120 * MS_MIN },
      ]) {
        if (overdue >= level.after) {
          const html = buildTimeHtml(
            "not_at_stop",
            tripId,
            `${facility} · +${Math.round(overdue / MS_MIN)}m`,
            `Sch ${formatLocal(String(stop.scheduled_arrival), tz)}`,
          );
          results.push({
            ...(await dispatchAlert(sb, botToken, config, settings, {
              tripId,
              stopId,
              alertType: "not_at_stop",
              level: level.key,
              html,
              meta: { facility, overdue_ms: overdue },
            })),
          });
        }
      }
    }

    // 9) Running late (ETA)
    if (!Number.isNaN(eta) && !Number.isNaN(sched) && Number.isNaN(actual)) {
      const slip = eta - sched;
      if (slip > LATE_GRACE_MS) {
        const baseLevel = "15";
        results.push({
          ...(await dispatchAlert(sb, botToken, config, settings, {
            tripId,
            stopId,
            alertType: "running_late",
            level: baseLevel,
            html: buildTimeHtml(
              "running_late",
              tripId,
              `${facility} · ETA +${Math.round(slip / MS_MIN)}m`,
              `ETA ${formatLocal(String(stop.eta), tz)}`,
            ),
            meta: { slip_ms: slip },
          })),
        });
        // Reslip buckets every +30m beyond first 15
        const extra = slip - LATE_GRACE_MS;
        const buckets = Math.floor(extra / ETA_RESLIP_MS);
        if (buckets >= 1) {
          results.push({
            ...(await dispatchAlert(sb, botToken, config, settings, {
              tripId,
              stopId,
              alertType: "running_late",
              level: `slip:${buckets}`,
              html: buildTimeHtml(
                "running_late",
                tripId,
                `${facility} · ETA slipped +${Math.round(slip / MS_MIN)}m`,
                `ETA ${formatLocal(String(stop.eta), tz)}`,
              ),
              meta: { slip_ms: slip, bucket: buckets },
            })),
          });
        }
      }
    }

    // 11) Late no reason
    if (!Number.isNaN(actual) && !Number.isNaN(sched) && actual - sched > LATE_GRACE_MS) {
      const waited = now - actual;
      if (waited >= LATE_REASON_WAIT_MS && !stop.late_reason) {
        results.push({
          ...(await dispatchAlert(sb, botToken, config, settings, {
            tripId,
            stopId,
            alertType: "late_no_reason",
            level: "30",
            html: buildTimeHtml(
              "late_no_reason",
              tripId,
              `${facility} arrived late`,
              `No reason after 30m`,
            ),
          })),
        });
      }
    }
  }

  // 10) CPT risk — at pickup (PUP), arrived, not departed, CPT soon/passed
  for (const leg of legs) {
    const tripId = String(leg.trip_id);
    const trip = tripById.get(tripId);
    if (!trip || !isActiveSection(trip.section)) continue;
    if (!leg.cpt) continue;
    const cpt = new Date(String(leg.cpt)).getTime();
    if (Number.isNaN(cpt)) continue;
    const legStops = stops
      .filter((s) => s.load_id === leg.load_id)
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
    const pickup = legStops.find((s) =>
      /PUP|PICK/i.test(String(s.stop_type || ""))
    ) || legStops[0];
    if (!pickup) continue;
    const atFacility = pickup.actual_arrival && !pickup.actual_departure;
    if (!atFacility) continue;
    const untilCpt = cpt - now;
    if (untilCpt <= CPT_RISK_MS) {
      const level = untilCpt <= 0 ? "passed" : "20";
      results.push({
        ...(await dispatchAlert(sb, botToken, config, settings, {
          tripId,
          stopId: String(pickup.stop_id),
          alertType: "cpt_risk",
          level,
          html: buildTimeHtml(
            "cpt_risk",
            tripId,
            `${pickup.facility_code || "PU"} still at facility`,
            untilCpt <= 0
              ? `CPT passed ${formatLocal(String(leg.cpt), config.timezone)}`
              : `CPT in ${Math.round(untilCpt / MS_MIN)}m`,
          ),
        })),
      });
    }
  }

  // no_driver for relay_trips
  for (const trip of trips || []) {
    if (trip.driver_name_raw) continue;
    if (!trip.start_time) continue;
    const start = new Date(trip.start_time).getTime();
    if (Number.isNaN(start)) continue;
    if (start - now > NO_DRIVER_HORIZON_MS || start < now - 60 * MS_MIN) continue;
    const built = buildStatusHtml(
      {
        kind: "no_driver",
        tripId: trip.trip_id,
        section: trip.section,
        startTime: trip.start_time,
      },
      config.timezone,
    );
    results.push({
      ...(await dispatchAlert(sb, botToken, config, settings, {
        tripId: trip.trip_id,
        alertType: "no_driver",
        level: built.level,
        html: built.html,
      })),
    });
  }

  return { paused: false, results, trips: tripIds.length, stops: stops.length };
}

export async function sendAllTestAlerts(
  sb: SupabaseClient,
  botToken: string,
  config: AlertConfig,
  settings: Map<string, AlertSetting>,
): Promise<Array<Record<string, unknown>>> {
  const tripId = "TEST-TRIP";
  const tz = config.timezone;
  const samples: StatusEvent[] = [
    { kind: "trip_booked", tripId, driver: "Test Driver", section: "UPCOMING" },
    {
      kind: "arrived",
      tripId,
      facility: "TEST1",
      actualAt: new Date().toISOString(),
      scheduledAt: new Date(Date.now() - 20 * MS_MIN).toISOString(),
      timing: "late",
      section: "IN_TRANSIT",
    },
    {
      kind: "departed",
      tripId,
      nextStopLabel: "TEST2",
      nextStopDue: new Date(Date.now() + 3 * 3600_000).toISOString(),
      section: "IN_TRANSIT",
    },
    { kind: "delivered", tripId, driver: "Test Driver", section: "IN_TRANSIT" },
    { kind: "cancelled", tripId, driver: "Test Driver", section: "UPCOMING" },
    {
      kind: "driver_changed",
      tripId,
      prevDriver: "Old Driver",
      driver: "New Driver",
      section: "IN_TRANSIT",
    },
    {
      kind: "no_driver",
      tripId,
      startTime: new Date(Date.now() + 2 * 3600_000).toISOString(),
      section: "UPCOMING",
    },
    { kind: "late_reason", tripId, lateReason: "Traffic delay on I-80", section: "IN_TRANSIT" },
  ];

  const out: Array<Record<string, unknown>> = [];
  for (const ev of samples) {
    const built = buildStatusHtml(ev, tz);
    out.push({
      alertType: ev.kind,
      ...(await dispatchAlert(sb, botToken, config, settings, {
        tripId,
        alertType: ev.kind,
        level: built.level,
        html: `[TEST] ${built.html}`,
        force: true,
        meta: { test: true },
      })),
    });
  }

  const timeKinds: Array<{
    kind: "not_at_stop" | "running_late" | "cpt_risk" | "late_no_reason";
    level: string;
    l2: string;
    l3: string;
  }> = [
    { kind: "not_at_stop", level: "15", l2: "TEST1 · +18m", l3: "Sch demo" },
    { kind: "running_late", level: "15", l2: "TEST1 · ETA +22m", l3: "ETA demo" },
    { kind: "cpt_risk", level: "20", l2: "PU still at facility", l3: "CPT in 12m" },
    { kind: "late_no_reason", level: "30", l2: "TEST1 arrived late", l3: "No reason after 30m" },
    // sync alerts
  ];
  for (const t of timeKinds) {
    out.push({
      alertType: t.kind,
      ...(await dispatchAlert(sb, botToken, config, settings, {
        tripId,
        stopId: "TEST-STOP",
        alertType: t.kind,
        level: t.level,
        html: `[TEST] ${buildTimeHtml(t.kind, tripId, t.l2, t.l3)}`,
        force: true,
        meta: { test: true },
      })),
    });
  }

  out.push({
    alertType: "sync_stopped",
    ...(await dispatchAlert(sb, botToken, config, settings, {
      tripId: "SYNC",
      alertType: "sync_stopped",
      level: "test",
      html: `[TEST] 🛑 Sync stopped\nNo successful Relay sync in 5m\nTime-based alerts paused`,
      force: true,
      meta: { test: true },
    })),
  });
  out.push({
    alertType: "sync_restored",
    ...(await dispatchAlert(sb, botToken, config, settings, {
      tripId: "SYNC",
      alertType: "sync_restored",
      level: "test",
      html: `[TEST] 🟢 Sync restored\nRelay sync is healthy again\nTime-based alerts resumed`,
      force: true,
      meta: { test: true },
    })),
  });

  return out;
}
