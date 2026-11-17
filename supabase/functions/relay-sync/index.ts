import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Relay-Extension-Key",
};

type LoadIn = {
  load_id: string;
  amazon_ref_id?: string | null;
  load_status: string;
  payment_status?: string | null;
  pickup_location: string;
  delivery_location: string;
  pickup_date: string;
  delivery_date: string;
  trailer_id?: string | null;
  trailer_type?: string | null;
  tractor_id?: string | null;
  parent_trip_id?: string | null;
  trip_bucket?: string | null;
  status_bar_state?: string | null;
  status_stop_index?: number | null;
  arrival_actual?: string | null;
  arrival_scheduled?: string | null;
  arrival_address?: string | null;
  job_type?: string | null;
  distance_miles?: number | null;
  rate_gross?: number | null;
  additional_charges?: number | null;
  payment_date?: string | null;
  driver_name_raw?: string | null;
  notes?: string | null;
  content_hash?: string | null;
  section?: string | null;
};

type PaymentIn = {
  reference_id?: string | null;
  amazon_ref_id?: string | null;
  load_id?: string | null;
  amount?: number | null;
  payment_date?: string | null;
  method?: string | null;
  payment_status?: string | null;
  notes?: string | null;
};

type StopIn = {
  seq?: number | null;
  stopType?: string | null;
  facilityCode?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  timeZone?: string | null;
  scheduledArrival?: string | null;
  actualArrival?: string | null;
  scheduledDeparture?: string | null;
  actualDeparture?: string | null;
  eta?: string | null;
  scheduledArrivalLocal?: string | null;
  actualArrivalLocal?: string | null;
  scheduledDepartureLocal?: string | null;
  actualDepartureLocal?: string | null;
  etaLocal?: string | null;
  lateReason?: string | null;
  arrivalTimeSource?: string | null;
  departureTimeSource?: string | null;
};

type LegIn = {
  loadId?: string | null;
  facilitySequence?: string | null;
  executionStatus?: string | null;
  equipmentType?: string | null;
  miles?: number | null;
  payout?: number | null;
  tractorId?: string | null;
  trailerId?: string | null;
  driver?: string | null;
  cpt?: string | null;
  stops?: StopIn[];
};

type TripIn = {
  tripId: string;
  version?: string | number | null;
  tab?: string | null;
  section?: string | null;
  tourState?: string | null;
  executionStatus?: string | null;
  workType?: string | null;
  businessType?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  totalMiles?: number | null;
  payout?: number | null;
  currency?: string | null;
  ratePerMile?: number | null;
  driver?: string | null;
  equipment?: string | null;
  status?: string | null;
  contentHash?: string | null;
  legs?: LegIn[];
  raw?: unknown;
};

type SnapshotIn = {
  section: string;
  tripIds: string[];
  totalRecords: number;
  syncedAt?: string;
};

const SECTION_OK = new Set(["IN_TRANSIT", "UPCOMING", "HISTORY"]);
const REMOVED_AFTER_MS = 10 * 60 * 1000;

function normalizeSection(raw: unknown): string | null {
  const s = String(raw || "").toUpperCase().replace(/-/g, "_");
  if (s === "INTRANSIT") return "IN_TRANSIT";
  if (SECTION_OK.has(s)) return s;
  return null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type TripAlertEvent = {
  kind: string;
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

function arrivalTiming(
  actualIso?: string | null,
  scheduledIso?: string | null,
): "late" | "early" | "on_time" | null {
  if (!actualIso || !scheduledIso) return null;
  const a = new Date(actualIso).getTime();
  const s = new Date(scheduledIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(s)) return null;
  const mins = Math.round((a - s) / 60000);
  if (mins > 15) return "late";
  if (mins < -15) return "early";
  return "on_time";
}

async function emitTripAlerts(events: TripAlertEvent[]) {
  if (!events.length) return;
  const base = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !service) return;
  try {
    await fetch(`${base}/functions/v1/trip-alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${service}`,
      },
      body: JSON.stringify({ action: "status", events }),
    });
  } catch {
    /* non-fatal */
  }
}

function requireExtensionKey(req: Request): string | Response {
  const expected = Deno.env.get("RELAY_EXTENSION_API_KEY");
  if (!expected) {
    return json({ success: false, error: "Server missing RELAY_EXTENSION_API_KEY" }, 500);
  }
  const provided = req.headers.get("X-Relay-Extension-Key") || "";
  if (!provided || provided !== expected) {
    return json({ success: false, error: "Unauthorized extension key" }, 401);
  }
  return expected;
}

/** Reject scrapes that used a schedule date as load_id (e.g. "Sep 29, 2026"). */
function isValidRelayLoadId(id: unknown): boolean {
  if (id == null) return false;
  const s = String(id).trim();
  if (!s || s.length < 6 || s.length > 40) return false;
  if (/\s/.test(s)) return false;
  if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)/i.test(s)) return false;
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(s)) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return false;
  if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(s)) return false;
  return /^T-[A-Z0-9]{5,}$/i.test(s) || /^[0-9]{2,3}[A-Z0-9]{5,}$/i.test(s);
}

function isCompleteLoad(load: LoadIn) {
  return Boolean(
    isValidRelayLoadId(load?.load_id) &&
      load?.load_status &&
      load?.pickup_location &&
      load?.delivery_location &&
      load?.pickup_date &&
      load?.delivery_date,
  );
}

/** True when scrape left a placeholder or numeric/money scrap instead of a place. */
function isBadPlace(raw: unknown): boolean {
  if (raw == null) return true;
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s || s.length < 3) return true;
  if (/^unknown\b/i.test(s)) return true;
  if (/^\$/.test(s) || /\$\s*[\d,]/.test(s)) return true;
  if (/^\d[\d,]*\.?\d*\s*(mi|miles)?\s*$/i.test(s)) return true;
  if (/^\/?Live$/i.test(s)) return true;
  if (/^[,.]/.test(s) || /^[a-z]/.test(s)) return true;
  return false;
}

function preferPlace(incoming: unknown, existing: unknown, fallback: string): string {
  const next = incoming == null ? "" : String(incoming).trim();
  const prev = existing == null ? "" : String(existing).trim();
  if (!isBadPlace(next)) return next.slice(0, 120);
  if (!isBadPlace(prev)) return prev.slice(0, 120);
  return fallback;
}

/** Reject city/UI scraps mistaken for drivers ("Colorado Springs", "Spot\\nStarts"). */
function sanitizeDriverName(raw: unknown): string | null {
  if (raw == null) return null;
  const firstLine = String(raw).split(/\n/)[0].replace(/\s+/g, " ").trim();
  if (!firstLine || firstLine.length < 3 || firstLine.length > 60) return null;
  if (
    /^(spot|starts|rejected|weather|driver|unassigned|n\/a|none|unknown|—|-)$/i.test(
      firstLine,
    )
  ) {
    return null;
  }
  if (/,\s*[A-Z]{2}\b/.test(firstLine) || /\d/.test(firstLine)) return null;
  if (
    /^(Colorado Springs|Santa Clarita|Kansas City|Fort Worth|Sparrows Point|Salt Lake|Los Angeles|San Diego|San Francisco|Las Vegas|New York|El Paso|St\.?\s*Louis|Corpus Christi|Oklahoma City|Virginia Beach|Palm Springs|Fort Collins|West Sacramento)$/i
      .test(firstLine)
  ) {
    return null;
  }
  if (
    /^(New|San|Los|Las|Fort|Port|Mount|Lake|North|South|East|West|Santa|Saint|St\.?|El|La|Des|Grand|Little|Palm|Corpus|Virginia|Oklahoma|Colorado|Kansas)\s+[A-Z]/i
      .test(firstLine) &&
    !/^[A-Z]\.\s/.test(firstLine)
  ) {
    return null;
  }
  if (/^[A-Z]\.\s*[A-Za-z][A-Za-z'-]{1,35}$/.test(firstLine)) return firstLine;
  if (/^[A-Za-z][A-Za-z'-]{1,30}\s+[A-Za-z][A-Za-z'-]{1,35}$/.test(firstLine)) {
    return firstLine;
  }
  if (/^[A-Za-z][A-Za-z'-]{2,35}$/.test(firstLine)) return firstLine;
  return null;
}

const TERMINAL_STATUSES = new Set(["Completed", "Delivered", "Cancelled", "Rejected"]);

/** Keep trip_bucket + load_status consistent so History never sticks as active. */
function normalizeLoadBucketStatus(load: LoadIn): LoadIn {
  let status = load.load_status;
  let bucket = load.trip_bucket ?? null;
  if (bucket === "history") {
    if (!status || status === "Booked" || status === "In Transit" || status === "Dispatched" || status === "Available") {
      status = "Completed";
    }
  }
  if (status && TERMINAL_STATUSES.has(status)) {
    bucket = "history";
  } else if (bucket === "history" && !status) {
    status = "Completed";
  }
  return { ...load, load_status: status, trip_bucket: bucket };
}

type DriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  notes: string | null;
  driver_id?: string | null;
};

function normName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match Relay display names ("U. Aminov", "Umed Aminov", "AMINOV UMED")
 * to CRM drivers (case-insensitive; initial+surname; swapped order; notes partners).
 */
function matchDriverId(rawName: string, drivers: DriverRow[]): string | null {
  const raw = String(rawName || "").trim().replace(/\s+/g, " ");
  if (!raw || !drivers.length) return null;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;

  const n = normName(raw);
  const tokens = n.split(" ").filter(Boolean);

  // Exact full-name forms: "umed aminov" / "aminov umed"
  for (const d of drivers) {
    const fn = normName(d.first_name || "");
    const ln = normName(d.last_name || "");
    if (!fn || !ln) continue;
    if (n === `${fn} ${ln}` || n === `${ln} ${fn}`) return d.id;
  }

  const looksInitial = (t: string) => /^[a-z]$/.test(t.replace(/\./g, ""));

  // "U. Aminov" / "U Aminov" → last=Aminov, first initial U
  if (parts.length >= 2) {
    const firstTok = normName(parts[0]);
    const lastTok = normName(parts[parts.length - 1]);
    const mid = parts.length > 2 ? normName(parts.slice(1, -1).join(" ")) : "";

    // Prefer surname = last token (Western Relay order)
    let candidates = drivers.filter((d) => normName(d.last_name || "") === lastTok);
    if (!candidates.length) {
      // Surname-first Relay rare: first token is surname
      candidates = drivers.filter((d) => normName(d.last_name || "") === firstTok);
    }
    // Also try first_name holding surname (bad seed) or notes
    if (!candidates.length) {
      candidates = drivers.filter((d) => {
        const hay = `${normName(d.first_name || "")} ${normName(d.last_name || "")} ${normName(d.notes || "")}`;
        return hay.includes(lastTok) || hay.includes(firstTok);
      });
    }

    if (looksInitial(firstTok) || /^[a-z]\.?$/.test(parts[0].toLowerCase())) {
      const initial = firstTok.charAt(0);
      const hit = candidates.find((d) => {
        const fn = normName(d.first_name || "");
        const ln = normName(d.last_name || "");
        // Umed Aminov: first starts with U, last Aminov
        if (ln === lastTok && fn.startsWith(initial)) return true;
        if (fn === lastTok && ln.startsWith(initial)) return true; // swapped storage
        // notes partner "Umed Aminov"
        const notes = normName(d.notes || "");
        if (notes.includes(lastTok) && new RegExp(`\\b${initial}[a-z]*\\b`).test(notes)) {
          return true;
        }
        return false;
      });
      if (hit) return hit.id;
    }

    // Full first + last
    const hitFull = candidates.find((d) => {
      const fn = normName(d.first_name || "");
      const ln = normName(d.last_name || "");
      if (ln === lastTok && (fn === firstTok || fn.startsWith(firstTok) || firstTok.startsWith(fn))) {
        return true;
      }
      if (fn === lastTok && (ln === firstTok || ln.startsWith(firstTok))) return true;
      if (mid && (fn.includes(mid) || normName(d.notes || "").includes(mid))) return true;
      return false;
    });
    if (hitFull) return hitFull.id;

    // Unique surname match
    if (candidates.length === 1) return candidates[0].id;
  }

  // Single token: unique first or last or notes
  if (tokens.length === 1) {
    const t = tokens[0];
    const byLast = drivers.filter((d) => normName(d.last_name || "") === t);
    if (byLast.length === 1) return byLast[0].id;
    const byFirst = drivers.filter((d) => normName(d.first_name || "") === t);
    if (byFirst.length === 1) return byFirst[0].id;
    const byNotes = drivers.filter((d) => normName(d.notes || "").includes(t));
    if (byNotes.length === 1) return byNotes[0].id;
  }

  // Fuzzy: all raw tokens appear across first/last/notes
  const scored = drivers
    .map((d) => {
      const hay = `${normName(d.first_name || "")} ${normName(d.last_name || "")} ${normName(d.notes || "")}`;
      const hits = tokens.filter((t) => t.length > 1 && hay.includes(t)).length;
      return { d, hits };
    })
    .filter((x) => x.hits >= Math.min(2, tokens.length))
    .sort((a, b) => b.hits - a.hits);
  if (scored.length && scored[0].hits > 0) {
    if (scored.length === 1 || scored[0].hits > scored[1].hits) return scored[0].d.id;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  const auth = requireExtensionKey(req);
  if (auth instanceof Response) return auth;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const body = await req.json();
    const loads: LoadIn[] = Array.isArray(body.loads) ? body.loads : [];
    const payments: PaymentIn[] = Array.isArray(body.payments) ? body.payments : [];
    const tripsIn: TripIn[] = Array.isArray(body.trips) ? body.trips : [];
    const snapshot: SnapshotIn | null =
      body.snapshot && typeof body.snapshot === "object" ? body.snapshot : null;
    const clientId = typeof body.client_id === "string" ? body.client_id : null;
    /**
     * When set (full Upcoming+In Transit pass), demote other active amazon_relay rows to History.
     * Empty array must NOT reconcile — JS treats [] as truthy and previously demoted the entire
     * active fleet whenever a soft pass found zero upcoming/in_transit ids (hidden tab, tab-switch
     * miss, or history-only scrape). Require at least one observed active id.
     */
    const reconcileActiveIds: string[] | null = Array.isArray(body.reconcile_active_ids)
      ? body.reconcile_active_ids.filter((id: unknown) => isValidRelayLoadId(id)).map(String)
      : null;
    const now = new Date().toISOString();
    /** Load ids upserted this request as non-terminal — never demote in the same pass. */
    const upsertedActiveIds = new Set<string>();

    const { data: run, error: runErr } = await sb
      .from("relay_sync_runs")
      .insert({
        status: "running",
        client_id: clientId,
        section_states: body.section_states || {},
      })
      .select("id")
      .single();
    if (runErr) return json({ success: false, error: runErr.message }, 500);

    let loadsInserted = 0;
    let loadsUpdated = 0;
    let loadsPaymentUpdated = 0;
    let paymentsUpserted = 0;
    let tripsUpserted = 0;
    let legsUpserted = 0;
    let stopsUpserted = 0;
    let snapshotMoved = 0;
    let snapshotRemoved = 0;
    let loadsReconciled = 0;
    const errors: string[] = [];
    const syncedLoadIds: string[] = [];
    const syncedPaymentRefs: string[] = [];
    const syncedTripIds: string[] = [];
    const sectionCounts: Record<string, { relay: number; crm: number; mismatch: boolean }> = {};
    const notifications: Array<{
      event_type: string;
      dedupe_key: string;
      message: string;
      driver_id?: string | null;
      trailer_id?: string | null;
      tractor_id?: string | null;
      load_id?: string | null;
    }> = [];
    const tripAlertEvents: TripAlertEvent[] = [];

    const { data: driverRows } = await sb
      .from("drivers")
      .select("id, first_name, last_name, notes, driver_id");
    const driversCache: DriverRow[] = (driverRows || []) as DriverRow[];

    // ---- New model: UPSERT relay_trips / relay_legs / relay_stops by tripId ----
    for (const trip of tripsIn) {
      const tripId = String(trip?.tripId || "").trim().toUpperCase();
      if (!tripId || !isValidRelayLoadId(tripId)) {
        errors.push(`Invalid tripId skipped: ${trip?.tripId || "(missing)"}`);
        continue;
      }
      const sourceTab = normalizeSection(trip.tab || trip.section);
      let section = sourceTab;
      const { data: prevTrip } = await sb
        .from("relay_trips")
        .select("trip_id, section, status, driver_name_raw, start_time, execution_status")
        .eq("trip_id", tripId)
        .maybeSingle();

      const nextDriver = sanitizeDriverName(trip.driver);
      let nextStatus = trip.status || trip.executionStatus || trip.tourState || null;
      const cancelBlob = `${nextStatus || ""} ${trip.tourState || ""} ${trip.executionStatus || ""}`.toLowerCase();
      const legs = (trip.legs as { executionStatus?: string; status?: string }[]) || [];
      const allLegsCancel =
        legs.length > 0 &&
        legs.every((leg) => /cancel/.test(String(leg.executionStatus || leg.status || "").toLowerCase()));
      const cancelled = /cancel/.test(cancelBlob) || allLegsCancel;
      if (cancelled) {
        section = "HISTORY";
        if (!nextStatus || !/cancel/i.test(String(nextStatus))) nextStatus = "CANCELLED";
      }
      const tripRow = {
        trip_id: tripId,
        section,
        source_tab: sourceTab,
        relay_version: trip.version != null ? String(trip.version) : null,
        last_seen_at: now,
        tour_state: trip.tourState ?? null,
        execution_status: trip.executionStatus ?? null,
        work_type: trip.workType ?? null,
        business_type: trip.businessType ?? null,
        start_time: trip.startTime ?? null,
        end_time: trip.endTime ?? null,
        total_miles: trip.totalMiles ?? null,
        payout: trip.payout ?? null,
        currency: trip.currency ?? null,
        rate_per_mile: trip.ratePerMile ?? null,
        driver_name_raw: nextDriver,
        equipment: trip.equipment ?? null,
        status: nextStatus,
        content_hash: trip.contentHash ?? null,
        raw: trip.raw ?? {},
        archived: false,
        updated_at: now,
      };
      const { error: tripErr } = await sb.from("relay_trips").upsert(tripRow, {
        onConflict: "trip_id",
      });
      if (tripErr) {
        errors.push(`Trip upsert ${tripId}: ${tripErr.message}`);
        continue;
      }
      tripsUpserted += 1;
      syncedTripIds.push(tripId);

      if (prevTrip?.section && prevTrip.section !== section) {
        await sb.from("trip_events").insert({
          trip_id: tripId,
          event_type: cancelled ? "cancelled_to_history" : "section_change",
          from_section: prevTrip.section,
          to_section: section,
          from_status: prevTrip.status,
          to_status: nextStatus,
          detail: { source_tab: sourceTab },
        }).then(() => null, () => null);
      }

      const liveSection = section === "UPCOMING" || section === "IN_TRANSIT";
      if (liveSection) {
        if (!prevTrip && section === "UPCOMING") {
          tripAlertEvents.push({
            kind: "trip_booked",
            tripId,
            section,
            driver: nextDriver,
          });
        }
        if (
          prevTrip &&
          String(prevTrip.driver_name_raw || "") !== String(nextDriver || "") &&
          (prevTrip.driver_name_raw || nextDriver)
        ) {
          tripAlertEvents.push({
            kind: "driver_changed",
            tripId,
            section,
            prevDriver: prevTrip.driver_name_raw,
            driver: nextDriver,
          });
        }
        const prevSt = String(prevTrip?.status || prevTrip?.execution_status || "").toLowerCase();
        const nextSt = String(nextStatus || "").toLowerCase();
        if (
          /cancel/.test(nextSt) &&
          !/cancel/.test(prevSt)
        ) {
          tripAlertEvents.push({
            kind: "cancelled",
            tripId,
            section,
            driver: nextDriver,
          });
        }
        if (
          (/deliver|complete/.test(nextSt) && !/deliver|complete/.test(prevSt)) ||
          (String(section) === "IN_TRANSIT" && /deliver|complete/.test(nextSt) && !prevTrip)
        ) {
          // delivered handled below with stronger signals too
        }
        if (/deliver|complete/.test(nextSt) && !/deliver|complete/.test(prevSt)) {
          tripAlertEvents.push({
            kind: "delivered",
            tripId,
            section,
            driver: nextDriver,
          });
        }
      }

      const orderedStops: Array<{
        stopId: string;
        stop: StopIn;
        loadId: string;
      }> = [];

      for (const leg of trip.legs || []) {
        const loadId = String(leg?.loadId || "").trim().toUpperCase();
        if (!loadId || !isValidRelayLoadId(loadId)) continue;
        const legRow = {
          load_id: loadId,
          trip_id: tripId,
          facility_sequence: leg.facilitySequence ?? null,
          execution_status: leg.executionStatus ?? null,
          equipment_type: leg.equipmentType ?? null,
          miles: leg.miles ?? null,
          payout: leg.payout ?? null,
          tractor_id: leg.tractorId ?? null,
          trailer_id: leg.trailerId ?? null,
          driver_name_raw: sanitizeDriverName(leg.driver),
          cpt: leg.cpt ?? null,
          raw: {},
          archived: false,
          last_seen_at: now,
          updated_at: now,
        };
        const { error: legErr } = await sb.from("relay_legs").upsert(legRow, {
          onConflict: "load_id",
        });
        if (legErr) {
          errors.push(`Leg upsert ${loadId}: ${legErr.message}`);
          continue;
        }
        legsUpserted += 1;

        for (const stop of leg.stops || []) {
          const seq = stop.seq ?? 0;
          const stopId = `${tripId}:${loadId}:${seq}`;
          orderedStops.push({ stopId, stop, loadId });
          const { data: prevStop } = await sb
            .from("relay_stops")
            .select(
              "stop_id, actual_arrival, actual_departure, scheduled_arrival, facility_code, stop_type, late_reason",
            )
            .eq("stop_id", stopId)
            .maybeSingle();

          const stopRow = {
            stop_id: stopId,
            load_id: loadId,
            trip_id: tripId,
            seq,
            stop_type: stop.stopType ?? null,
            facility_code: stop.facilityCode ?? null,
            address: stop.address ?? null,
            city: stop.city ?? null,
            state: stop.state ?? null,
            zip: stop.zip ?? null,
            time_zone: stop.timeZone ?? null,
            scheduled_arrival: stop.scheduledArrival ?? null,
            actual_arrival: stop.actualArrival ?? null,
            scheduled_departure: stop.scheduledDeparture ?? null,
            actual_departure: stop.actualDeparture ?? null,
            eta: stop.eta ?? null,
            scheduled_arrival_local: stop.scheduledArrivalLocal ?? null,
            actual_arrival_local: stop.actualArrivalLocal ?? null,
            scheduled_departure_local: stop.scheduledDepartureLocal ?? null,
            actual_departure_local: stop.actualDepartureLocal ?? null,
            eta_local: stop.etaLocal ?? null,
            late_reason: stop.lateReason ?? null,
            arrival_time_source: stop.arrivalTimeSource ?? null,
            departure_time_source: stop.departureTimeSource ?? null,
            raw: {},
            archived: false,
            updated_at: now,
          };
          const { error: stopErr } = await sb.from("relay_stops").upsert(stopRow, {
            onConflict: "stop_id",
          });
          if (stopErr) errors.push(`Stop upsert ${stopId}: ${stopErr.message}`);
          else stopsUpserted += 1;

          if (!liveSection) continue;
          if (stop.actualArrival && !prevStop?.actual_arrival) {
            tripAlertEvents.push({
              kind: "arrived",
              tripId,
              stopId,
              section,
              facility: stop.facilityCode || stop.stopType || "Stop",
              actualAt: stop.actualArrival,
              scheduledAt: stop.scheduledArrival || prevStop?.scheduled_arrival,
              timing: arrivalTiming(
                stop.actualArrival,
                stop.scheduledArrival || prevStop?.scheduled_arrival,
              ),
            });
          }
          if (stop.actualDeparture && !prevStop?.actual_departure) {
            // next stop due = next in ordered list (filled after loop) — placeholder, refined below
            tripAlertEvents.push({
              kind: "departed",
              tripId,
              stopId,
              section,
              facility: stop.facilityCode || stop.stopType || "Stop",
              nextStopLabel: null,
              nextStopDue: null,
            });
          }
        }
      }

      // Fill next-stop info on departed events for this trip
      if (liveSection && orderedStops.length) {
        for (let i = 0; i < orderedStops.length; i += 1) {
          const cur = orderedStops[i];
          const next = orderedStops[i + 1];
          for (const ev of tripAlertEvents) {
            if (ev.kind === "departed" && ev.stopId === cur.stopId && ev.tripId === tripId) {
              ev.nextStopLabel = next
                ? String(next.stop.facilityCode || next.stop.stopType || `Stop ${next.stop.seq}`)
                : "—";
              ev.nextStopDue = next?.stop.scheduledArrival || null;
            }
          }
        }
      }
    }

    // ---- Section snapshot reconcile ----
    if (snapshot?.section && Array.isArray(snapshot.tripIds)) {
      const section = normalizeSection(snapshot.section);
      if (!section) {
        errors.push(`Invalid snapshot section: ${snapshot.section}`);
      } else {
        const tripIds = [
          ...new Set(
            snapshot.tripIds
              .map((id) => String(id || "").trim().toUpperCase())
              .filter((id) => isValidRelayLoadId(id)),
          ),
        ];
        const totalRecords = Number(snapshot.totalRecords) || 0;
        const syncedAt = snapshot.syncedAt || now;

        const { data: sectionRows, count: priorCount } = await sb
          .from("relay_trips")
          .select("trip_id, last_seen_at, status", { count: "exact" })
          .eq("section", section)
          .eq("archived", false);

        // Never apply empty section sync if this section previously had trips.
        if (tripIds.length === 0 && (priorCount || 0) > 0) {
          const msg =
            `Skipped empty ${section} snapshot: CRM had ${priorCount} trip(s); refusing wipe`;
          console.warn(msg);
          errors.push(msg);
          sectionCounts[section] = {
            relay: 0,
            crm: priorCount || 0,
            mismatch: true,
          };
        } else {
          const inSnapshot = new Set(tripIds);
          for (const row of sectionRows || []) {
            if (inSnapshot.has(row.trip_id)) continue;
            const { error } = await sb
              .from("relay_trips")
              .update({
                status: "moved_awaiting_section",
                updated_at: now,
              })
              .eq("trip_id", row.trip_id);
            if (error) errors.push(`Snapshot move ${row.trip_id}: ${error.message}`);
            else {
              snapshotMoved += 1;
              await sb.from("trip_events").insert({
                trip_id: row.trip_id,
                event_type: "moved_awaiting_section",
                from_section: section,
                to_section: section,
                from_status: row.status,
                to_status: "moved_awaiting_section",
              }).then(() => null, () => null);
            }
          }

          // Not seen in any section within 10 minutes → removed_from_relay
          const cutoff = new Date(Date.now() - REMOVED_AFTER_MS).toISOString();
          const { data: stale } = await sb
            .from("relay_trips")
            .select("trip_id, last_seen_at, status")
            .eq("archived", false)
            .in("status", ["moved_awaiting_section", "In Transit", "Booked", "IN_PROGRESS"])
            .lt("last_seen_at", cutoff);
          for (const row of stale || []) {
            if (inSnapshot.has(row.trip_id)) continue;
            const { error } = await sb
              .from("relay_trips")
              .update({
                status: "removed_from_relay",
                section: "HISTORY",
                updated_at: now,
              })
              .eq("trip_id", row.trip_id);
            if (error) errors.push(`Snapshot remove ${row.trip_id}: ${error.message}`);
            else {
              snapshotRemoved += 1;
              await sb.from("trip_events").insert({
                trip_id: row.trip_id,
                event_type: "removed_from_relay",
                from_section: section,
                to_section: "HISTORY",
                from_status: row.status,
                to_status: "removed_from_relay",
              }).then(() => null, () => null);
            }
          }

          const { count: crmCount } = await sb
            .from("relay_trips")
            .select("trip_id", { count: "exact", head: true })
            .eq("section", section)
            .eq("archived", false)
            .neq("status", "removed_from_relay");

          const crm = crmCount ?? 0;
          const mismatch = crm !== tripIds.length;
          await sb.from("relay_section_snapshots").upsert(
            {
              section,
              trip_ids: tripIds,
              total_records: totalRecords,
              crm_count: crm,
              mismatch,
              synced_at: syncedAt,
              updated_at: now,
            },
            { onConflict: "section" },
          );
          sectionCounts[section] = {
            relay: tripIds.length,
            crm,
            mismatch,
          };
        }
      }
    }

    for (const rawLoad of loads) {
      const load = normalizeLoadBucketStatus(rawLoad);
      if (!isValidRelayLoadId(load?.load_id)) {
        errors.push(
          `Invalid load_id skipped (expected T-… / leg id, not a date): ${load?.load_id || "(missing id)"}`,
        );
        continue;
      }
      if (!isCompleteLoad(load)) {
        errors.push(`Incomplete load skipped: ${load?.load_id || "(missing id)"}`);
        continue;
      }

      const { data: existing, error: findErr } = await sb
        .from("loads")
        .select(
          "id, load_id, load_status, payment_status, content_hash, status_history, trailer_id, tractor_id, driver_id, status_bar_state, status_stop_index, arrival_actual, arrival_scheduled, arrival_address, trip_bucket, parent_trip_id, driver_name_raw, pickup_location, delivery_location, rate_gross, late_reason, late_reason_at, notes",
        )
        .eq("load_id", load.load_id)
        .maybeSingle();
      if (findErr) {
        errors.push(`Lookup failed ${load.load_id}: ${findErr.message}`);
        continue;
      }

      const driverName =
        sanitizeDriverName(load.driver_name_raw) ||
        sanitizeDriverName(existing?.driver_name_raw);
      const driverId = driverName
        ? matchDriverId(driverName, driversCache) || existing?.driver_id || null
        : existing?.driver_id || null;

      const statusHistory = Array.isArray(existing?.status_history)
        ? [...existing.status_history]
        : [];
      if (!existing || existing.load_status !== load.load_status) {
        statusHistory.push({
          status: load.load_status,
          timestamp: now,
          note: "Observed from Amazon Relay page",
        });
        // Groups only receive facility-arrival alerts (no load_status / payment spam).
      }

      // Trailer changes are synced to CRM but not pushed to Telegram groups.

      const nextBar = load.status_bar_state || null;
      const prevBar = existing?.status_bar_state || null;
      if (nextBar && nextBar !== prevBar && nextBar === "arrived") {
        const stop = load.status_stop_index ?? existing?.status_stop_index ?? 1;
        const trip = load.parent_trip_id || existing?.parent_trip_id || load.load_id;
        const driverLabel = driverName || existing?.driver_name_raw || "driver";
        const trailer = load.trailer_id ?? existing?.trailer_id ?? "—";
        const tractor = load.tractor_id ?? existing?.tractor_id ?? "—";
        const arrivedAt =
          load.arrival_actual || existing?.arrival_actual || "—";
        const scheduledAt =
          load.arrival_scheduled || existing?.arrival_scheduled || "—";
        const address =
          load.arrival_address ||
          existing?.arrival_address ||
          load.pickup_location ||
          existing?.pickup_location ||
          load.delivery_location ||
          existing?.delivery_location ||
          "—";
        const route =
          `${load.pickup_location || existing?.pickup_location || "?"} → ${load.delivery_location || existing?.delivery_location || "?"}`;
        notifications.push({
          event_type: "facility_arrived",
          dedupe_key: `arrived:${load.load_id}:stop:${stop}`,
          message:
            `Facility arrival (stop ${stop})\n` +
            `Trip ${trip} · Load ${load.load_id}\n` +
            `Driver: ${driverLabel}\n` +
            `Trailer: ${trailer}\n` +
            `Tractor: ${tractor}\n` +
            `Address: ${address}\n` +
            `Arrived: ${arrivedAt}\n` +
            `Sch.: ${scheduledAt}\n` +
            `Route: ${route}`,
          driver_id: driverId || existing?.driver_id,
          trailer_id: load.trailer_id ?? existing?.trailer_id,
          tractor_id: load.tractor_id ?? existing?.tractor_id,
          load_id: load.load_id,
        });
      }

      // Dispatch trip alerts from load-level live changes (Upcoming / In Transit only)
      const bucket = String(load.trip_bucket || existing?.trip_bucket || "").toLowerCase();
      const liveBucket = bucket === "upcoming" || bucket === "in_transit";
      const tripKey = String(load.parent_trip_id || existing?.parent_trip_id || load.load_id);
      if (liveBucket) {
        if (!existing && bucket === "upcoming") {
          tripAlertEvents.push({
            kind: "trip_booked",
            tripId: tripKey,
            section: bucket === "upcoming" ? "UPCOMING" : "IN_TRANSIT",
            driver: driverName,
          });
        }
        if (
          existing &&
          existing.load_status !== load.load_status &&
          /cancel/i.test(String(load.load_status))
        ) {
          tripAlertEvents.push({
            kind: "cancelled",
            tripId: tripKey,
            section: bucket === "upcoming" ? "UPCOMING" : "IN_TRANSIT",
            driver: driverName,
          });
        }
        if (
          existing &&
          existing.load_status !== load.load_status &&
          /deliver|complete/i.test(String(load.load_status))
        ) {
          tripAlertEvents.push({
            kind: "delivered",
            tripId: tripKey,
            section: "IN_TRANSIT",
            driver: driverName,
          });
        }
        if (
          existing &&
          String(existing.driver_name_raw || "") !== String(driverName || "") &&
          (existing.driver_name_raw || driverName)
        ) {
          tripAlertEvents.push({
            kind: "driver_changed",
            tripId: tripKey,
            section: bucket === "upcoming" ? "UPCOMING" : "IN_TRANSIT",
            prevDriver: existing.driver_name_raw,
            driver: driverName,
          });
        }
        // Late reason from notes pattern "Late: …" when newly appearing
        const notesText = String(load.notes || "");
        const lateMatch = notesText.match(/late\s*:\s*(.+)$/i);
        if (lateMatch && !existing?.late_reason) {
          tripAlertEvents.push({
            kind: "late_reason",
            tripId: tripKey,
            section: bucket === "upcoming" ? "UPCOMING" : "IN_TRANSIT",
            lateReason: lateMatch[1].trim().slice(0, 200),
          });
        }
      }

      const row = {
        load_id: load.load_id,
        amazon_ref_id: load.amazon_ref_id ?? null,
        driver_id: driverId,
        driver_name_raw: driverName,
        load_status: load.load_status,
        payment_status: load.payment_status || existing?.payment_status || "Not Received",
        // Never clobber a real city/state with Unknown / $ scraps from a collapsed scrape
        pickup_location: preferPlace(
          load.pickup_location,
          existing?.pickup_location,
          "Unknown origin",
        ),
        delivery_location: preferPlace(
          load.delivery_location,
          existing?.delivery_location,
          "Unknown destination",
        ),
        pickup_date: load.pickup_date,
        delivery_date: load.delivery_date,
        // Keep prior equipment when a collapsed scrape omits Trailer/Tractor
        trailer_id: load.trailer_id ?? existing?.trailer_id ?? null,
        trailer_type: load.trailer_type ?? existing?.trailer_type ?? null,
        tractor_id: load.tractor_id ?? existing?.tractor_id ?? null,
        parent_trip_id: load.parent_trip_id ?? null,
        trip_bucket: load.trip_bucket ?? null,
        status_bar_state: load.status_bar_state ?? null,
        status_stop_index: load.status_stop_index ?? null,
        arrival_actual: load.arrival_actual ?? existing?.arrival_actual ?? null,
        arrival_scheduled: load.arrival_scheduled ?? existing?.arrival_scheduled ?? null,
        arrival_address: load.arrival_address ?? existing?.arrival_address ?? null,
        job_type: load.job_type ?? null,
        distance_miles: load.distance_miles ?? 0,
        rate_gross: load.rate_gross ?? 0,
        additional_charges: load.additional_charges ?? 0,
        payment_date: load.payment_date ?? null,
        notes: load.notes ?? null,
        status_history: statusHistory,
        last_observed: now,
        last_synchronized: now,
        content_hash: load.content_hash ?? null,
        source: "amazon_relay",
        is_stale: false,
        updated_at: now,
        late_reason: (() => {
          const m = String(load.notes || "").match(/late\s*:\s*(.+)$/i);
          if (m) return m[1].trim().slice(0, 500);
          return existing?.late_reason ?? null;
        })(),
        late_reason_at: (() => {
          const m = String(load.notes || "").match(/late\s*:\s*(.+)$/i);
          if (m && !existing?.late_reason) return now;
          return existing?.late_reason_at ?? null;
        })(),
      };

      if (!existing) {
        // UPSERT on load_id so concurrent tab scans never hit loads_load_id_key
        const { error } = await sb.from("loads").upsert(row, {
          onConflict: "load_id",
          ignoreDuplicates: false,
        });
        if (error) {
          errors.push(`Upsert ${load.load_id}: ${error.message}`);
          continue;
        }
        loadsInserted += 1;
        syncedLoadIds.push(load.load_id);
        if (
          row.trip_bucket === "upcoming" ||
          row.trip_bucket === "in_transit" ||
          !TERMINAL_STATUSES.has(String(row.load_status))
        ) {
          upsertedActiveIds.add(String(load.load_id).toUpperCase());
        }
        await sb.from("activity_logs").insert({
          type: "load",
          action: "created",
          description: `Amazon Relay load ${load.load_id} synced`,
          entity_id: load.load_id,
          user_name: "Relay Extension",
        });
      } else if (existing.content_hash && load.content_hash && existing.content_hash === load.content_hash) {
        const { error } = await sb
          .from("loads")
          .update({ last_observed: now, last_synchronized: now, is_stale: false })
          .eq("load_id", load.load_id);
        if (error) errors.push(`Touch ${load.load_id}: ${error.message}`);
        else {
          syncedLoadIds.push(load.load_id);
          loadsUpdated += 1;
          if (
            row.trip_bucket === "upcoming" ||
            row.trip_bucket === "in_transit" ||
            !TERMINAL_STATUSES.has(String(row.load_status))
          ) {
            upsertedActiveIds.add(String(load.load_id).toUpperCase());
          }
        }
      } else {
        const { error } = await sb
          .from("loads")
          .upsert(
            { ...row, last_changed: now },
            { onConflict: "load_id", ignoreDuplicates: false },
          );
        if (error) {
          errors.push(`Upsert ${load.load_id}: ${error.message}`);
          continue;
        }
        loadsUpdated += 1;
        syncedLoadIds.push(load.load_id);
        if (
          row.trip_bucket === "upcoming" ||
          row.trip_bucket === "in_transit" ||
          !TERMINAL_STATUSES.has(String(row.load_status))
        ) {
          upsertedActiveIds.add(String(load.load_id).toUpperCase());
        }
        // Payment status still upserts to CRM; Telegram no longer notifies payments.
      }
    }

    for (const payment of payments) {
      const ref = payment.reference_id || payment.amazon_ref_id || payment.load_id;
      if (!ref) {
        errors.push("Payment missing reference");
        continue;
      }

      if (payment.load_id && payment.payment_status) {
        const { data: loadRow } = await sb
          .from("loads")
          .select("id, payment_status")
          .eq("load_id", payment.load_id)
          .maybeSingle();
        if (loadRow && loadRow.payment_status !== payment.payment_status) {
          await sb
            .from("loads")
            .update({
              payment_status: payment.payment_status,
              payment_date: payment.payment_date ?? null,
              last_observed: now,
              last_changed: now,
              last_synchronized: now,
            })
            .eq("id", loadRow.id);
          loadsPaymentUpdated += 1;
        }
      }

      if (payment.amount == null || !payment.payment_date) {
        // Status-only updates are valid; skip payment row insert when incomplete
        if (payment.payment_status) syncedPaymentRefs.push(ref);
        continue;
      }

      const { data: existingPay } = await sb
        .from("payments")
        .select("id, amount, payment_date, content_hash")
        .eq("reference_id", ref)
        .maybeSingle();

      const payRow = {
        settlement_id: null,
        load_id: null as string | null,
        payment_date: payment.payment_date,
        method: payment.method || "Amazon Relay",
        reference_id: ref,
        amount: payment.amount,
        notes: payment.notes ?? null,
        amazon_ref_id: payment.amazon_ref_id ?? payment.load_id ?? null,
        last_observed: now,
        last_synchronized: now,
        content_hash: `${ref}|${payment.amount}|${payment.payment_date}`,
        source: "amazon_relay",
      };

      if (payment.load_id) {
        const { data: loadRow } = await sb
          .from("loads")
          .select("id")
          .eq("load_id", payment.load_id)
          .maybeSingle();
        payRow.load_id = loadRow?.id ?? null;
      }

      if (!existingPay) {
        const { error } = await sb.from("payments").insert(payRow);
        if (error) errors.push(`Payment insert ${ref}: ${error.message}`);
        else {
          paymentsUpserted += 1;
          syncedPaymentRefs.push(ref);
        }
      } else if (existingPay.content_hash !== payRow.content_hash) {
        const { error } = await sb
          .from("payments")
          .update({ ...payRow, last_changed: now })
          .eq("id", existingPay.id);
        if (error) errors.push(`Payment update ${ref}: ${error.message}`);
        else {
          paymentsUpserted += 1;
          syncedPaymentRefs.push(ref);
        }
      } else {
        await sb
          .from("payments")
          .update({ last_observed: now, last_synchronized: now })
          .eq("id", existingPay.id);
        syncedPaymentRefs.push(ref);
      }
    }

    // Mark loads not observed recently as stale (36h)
    const staleBefore = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    await sb
      .from("loads")
      .update({ is_stale: true })
      .lt("last_observed", staleBefore)
      .eq("source", "amazon_relay")
      .eq("is_stale", false);

    // Full active pass: anything still upcoming/in_transit but not in Relay's active set → History
    // Skip empty reconcile sets — they wipe the active fleet (see comment above).
    if (reconcileActiveIds && reconcileActiveIds.length > 0) {
      const activeSet = new Set([
        ...reconcileActiveIds.map((id) => id.toUpperCase()),
        ...upsertedActiveIds,
      ]);
      const { data: activeRows, error: activeErr } = await sb
        .from("loads")
        .select("id, load_id, load_status, trip_bucket, status_history")
        .eq("source", "amazon_relay")
        .in("trip_bucket", ["upcoming", "in_transit"]);
      if (activeErr) {
        errors.push(`Active reconcile lookup: ${activeErr.message}`);
      } else {
        const currentActiveCount = (activeRows || []).length;
        const scrapedActiveCount = activeSet.size;
        // Viewport-only scrapes (~6 of ~15) must not demote the unscrolled remainder.
        const incomplete =
          currentActiveCount > 0 &&
          scrapedActiveCount < Math.max(3, Math.floor(currentActiveCount * 0.55));
        if (incomplete) {
          errors.push(
            `Skipped reconcile demotion: scraped ${scrapedActiveCount} active id(s) vs ${currentActiveCount} in CRM (incomplete list scrape)`,
          );
        } else {
          for (const row of activeRows || []) {
            const lid = String(row.load_id || "").toUpperCase();
            if (!lid || activeSet.has(lid)) continue;
            if (TERMINAL_STATUSES.has(String(row.load_status))) {
              const { error } = await sb
                .from("loads")
                .update({
                  trip_bucket: "history",
                  last_changed: now,
                  last_synchronized: now,
                  updated_at: now,
                })
                .eq("id", row.id);
              if (!error) loadsReconciled += 1;
              continue;
            }
            const nextStatus = "Completed";
            const prevHistory = Array.isArray(row.status_history) ? row.status_history : [];
            const { error } = await sb
              .from("loads")
              .update({
                trip_bucket: "history",
                load_status: nextStatus,
                last_changed: now,
                last_synchronized: now,
                last_observed: now,
                updated_at: now,
                status_history: [
                  ...prevHistory,
                  {
                    status: nextStatus,
                    timestamp: now,
                    note: "Reconciled off Relay active set (Upcoming/In Transit)",
                  },
                ],
              })
              .eq("id", row.id);
            if (error) errors.push(`Reconcile ${row.load_id}: ${error.message}`);
            else loadsReconciled += 1;
          }
        }
      }

      // Also fix any terminal-status rows still tagged upcoming/in_transit
      await sb
        .from("loads")
        .update({ trip_bucket: "history", updated_at: now, last_synchronized: now })
        .eq("source", "amazon_relay")
        .in("trip_bucket", ["upcoming", "in_transit"])
        .in("load_status", ["Completed", "Delivered", "Cancelled", "Rejected"]);
    }

    const finishedAt = new Date().toISOString();
    await sb
      .from("relay_sync_runs")
      .update({
        finished_at: finishedAt,
        status: errors.length ? "completed_with_errors" : "completed",
        records_collected: loads.length + payments.length + tripsIn.length,
        records_updated:
          loadsUpdated +
          paymentsUpserted +
          loadsPaymentUpdated +
          loadsReconciled +
          tripsUpserted +
          legsUpserted +
          stopsUpserted,
        records_inserted: loadsInserted,
        error_count: errors.length,
        errors,
        section_states: body.section_states || {},
      })
      .eq("id", run.id);

    // Deduplicate trip alert events by kind+trip+stop
    const seenAlert = new Set<string>();
    const uniqueAlerts: TripAlertEvent[] = [];
    for (const ev of tripAlertEvents) {
      const key = `${ev.kind}:${ev.tripId}:${ev.stopId || ""}`;
      if (seenAlert.has(key)) continue;
      seenAlert.add(key);
      uniqueAlerts.push(ev);
    }
    await emitTripAlerts(uniqueAlerts);

    return json({
      success: true,
      run_id: run.id,
      loads_inserted: loadsInserted,
      loads_updated: loadsUpdated,
      loads_payment_updated: loadsPaymentUpdated,
      loads_reconciled: loadsReconciled,
      payments_upserted: paymentsUpserted,
      trips_upserted: tripsUpserted,
      legs_upserted: legsUpserted,
      stops_upserted: stopsUpserted,
      snapshot_moved: snapshotMoved,
      snapshot_removed: snapshotRemoved,
      synced_load_ids: syncedLoadIds,
      synced_payment_refs: syncedPaymentRefs,
      synced_trip_ids: syncedTripIds,
      section_counts: sectionCounts,
      errors,
      notifications,
      trip_alerts_queued: uniqueAlerts.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ msg: "relay-sync fatal", error: message }));
    return json({ success: false, error: message }, 500);
  }
});
