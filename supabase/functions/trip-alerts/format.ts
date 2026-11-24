/** ARRIVED + NOT AT STOP Telegram HTML templates (rebuild IS-55). */

export function esc(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatTimeAbbr(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(String(iso)).slice(0, 24);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
    return `${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
  } catch {
    return esc(iso).slice(0, 24);
  }
}

export function sourceLabel(src: string | null | undefined): string {
  const s = String(src || "").toUpperCase();
  if (s === "YMS") return "Yard check-in";
  if (s === "MOBILE") return "Driver app";
  if (s === "MOBILE_GEOFENCED" || s === "GEOFENCE") return "Geofence";
  if (!s) return "Unknown";
  return s;
}

export function timingBadge(
  actualIso: string | null | undefined,
  plannedIso: string | null | undefined,
): { label: string; emoji: string; minutes: number | null } {
  if (!actualIso || !plannedIso) return { label: "On time", emoji: "🟢", minutes: null };
  const actual = new Date(actualIso).getTime();
  const planned = new Date(plannedIso).getTime();
  if (Number.isNaN(actual) || Number.isNaN(planned)) {
    return { label: "On time", emoji: "🟢", minutes: null };
  }
  const mins = Math.round((actual - planned) / 60_000);
  if (mins > 15) {
    const abs = Math.abs(mins);
    const label =
      abs >= 60
        ? `${Math.floor(abs / 60)}h ${abs % 60} min late`
        : `${abs} min late`;
    return { label, emoji: "🔴", minutes: mins };
  }
  if (mins < -15) {
    const abs = Math.abs(mins);
    return { label: `${abs} min early`, emoji: "🔵", minutes: mins };
  }
  return { label: "On time", emoji: "🟢", minutes: mins };
}

export function formatDurationMinutes(mins: number): string {
  const abs = Math.abs(Math.round(mins));
  if (abs >= 60) return `${Math.floor(abs / 60)}h ${abs % 60} min`;
  return `${abs} min`;
}

export type ArrivedInput = {
  facility: string;
  city?: string | null;
  state?: string | null;
  tripId: string;
  loadId: string;
  stopSeq: number;
  stopCount: number;
  stopType?: string | null;
  actualAt: string;
  plannedAt?: string | null;
  timeZone: string;
  tractor?: string | null;
  trailer?: string | null;
  timeSource?: string | null;
  /** Driver on THIS stop's leg (shared group: dispatchers scan by name). */
  driver?: string | null;
  /** Minutes between the check-in and when we saw it (Relay/YMS can post late). */
  reportedAfterMinutes?: number | null;
  /** Our Relay sync was offline in that time (computer asleep / Chrome closed). */
  syncGap?: { start: string; end: string; minutes: number } | null;
  /** Relay pickup / delivery instructions for this stop. */
  instructions?: string | null;
  test?: boolean;
};

function driverHead(driver: string | null | undefined): string {
  const d = String(driver || "").trim();
  return d ? `<b>${esc(d)}</b>` : "<b>Driver —</b>";
}

export function formatArrivedHtml(input: ArrivedInput): string {
  const place = [input.city, input.state].filter(Boolean).join(", ");
  const timing = timingBadge(input.actualAt, input.plannedAt);
  const stopType = input.stopType ? ` (${esc(input.stopType)})` : "";
  const trailer = input.trailer?.trim() || "Bobtail";
  const prefix = input.test ? "[TEST] " : "";
  const lines = [
    `${prefix}📍 ${driverHead(input.driver)} · Arrived <b>${esc(input.facility)}</b>${place ? ` (${esc(place)})` : ""}`,
    `Trip <b>${esc(input.tripId)}</b> · Load ${esc(input.loadId)} · Stop ${input.stopSeq} of ${input.stopCount}${stopType}`,
    `Arrived <b>${esc(formatTimeAbbr(input.actualAt, input.timeZone))}</b>` +
      (input.plannedAt
        ? ` · Scheduled ${esc(formatTimeAbbr(input.plannedAt, input.timeZone))}`
        : ""),
    `${timing.emoji} <b>${esc(timing.label)}</b>`,
    `🚛 Tractor <b>${esc(input.tractor || "—")}</b> · Trailer <b>${esc(trailer)}</b>`,
    `Source: ${esc(sourceLabel(input.timeSource))}`,
  ];
  if (input.reportedAfterMinutes != null && input.reportedAfterMinutes >= 10) {
    const late = esc(formatDurationMinutes(input.reportedAfterMinutes));
    if (input.syncGap) {
      lines.push(
        `<i>⚠️ Sent ${late} late: CRM sync was offline ${esc(formatTimeAbbr(input.syncGap.start, input.timeZone))}–${esc(formatTimeAbbr(input.syncGap.end, input.timeZone))} (extension computer asleep or Chrome closed)</i>`,
      );
    } else {
      lines.push(`<i>Relay posted this check-in ${late} after it happened</i>`);
    }
  }
  if (input.instructions) {
    const kind = /drop|deliver/i.test(String(input.stopType || "")) ? "Drop-off" : "Pickup";
    lines.push("", `📋 <b>${kind} instructions</b>`, esc(input.instructions));
  }
  return lines.join("\n");
}

/** Zero-width chars / CRs out, collapse blank lines, cap length (Telegram 4096). */
export function cleanInstructions(parts: unknown, max = 900): string | null {
  const list = Array.isArray(parts) ? parts : parts ? [parts] : [];
  const text = list
    .map((p) => String(p ?? ""))
    .join("\n")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function placeOf(city?: string | null, state?: string | null): string {
  const p = [city, state].filter(Boolean).join(", ");
  return p ? ` (${esc(p)})` : "";
}

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type RouteStop = {
  facility: string;
  city?: string | null;
  state?: string | null;
  stopType?: string | null;
  scheduledAt?: string | null;
  timeZone: string;
};

function dayTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(d);
    return `${day}, ${formatTimeAbbr(iso, timeZone)}`;
  } catch {
    return formatTimeAbbr(iso, timeZone);
  }
}

function routeLines(stops: RouteStop[]): string[] {
  if (!stops.length) return [];
  const first = stops[0];
  const last = stops[stops.length - 1];
  const out = [
    `PU <b>${esc(first.facility)}</b>${placeOf(first.city, first.state)} · ${esc(dayTime(first.scheduledAt, first.timeZone))}`,
  ];
  if (stops.length > 1) {
    out.push(
      `→ <b>${esc(last.facility)}</b>${placeOf(last.city, last.state)} · ${esc(dayTime(last.scheduledAt, last.timeZone))}`,
    );
  }
  return out;
}

export type BookedInput = {
  tripId: string;
  stops: RouteStop[];
  stopCount: number;
  legCount: number;
  miles?: number | null;
  payout?: number | null;
  drivers: string[];
  workType?: string | null;
};

export function formatBookedHtml(input: BookedInput): string {
  const rpm = input.payout && input.miles ? Number(input.payout) / Number(input.miles) : null;
  const lines = [
    `🆕 <b>BOOKED</b> · Trip <b>${esc(input.tripId)}</b>${input.workType ? ` · ${esc(input.workType)}` : ""}`,
    ...routeLines(input.stops),
    `${input.legCount} leg${input.legCount === 1 ? "" : "s"} · ${input.stopCount} stops` +
      (input.miles ? ` · ${Math.round(Number(input.miles))} mi` : ""),
    `💵 <b>${esc(money(input.payout))}</b>${rpm ? ` · $${rpm.toFixed(2)}/mi` : ""}`,
    `👤 ${input.drivers.length ? `<b>${esc(input.drivers.join(", "))}</b>` : "<b>No driver assigned yet</b>"}`,
  ];
  return lines.join("\n");
}

export type CancelledInput = {
  tripId: string;
  /** null = whole trip cancelled. */
  loadId: string | null;
  stops: RouteStop[];
  driver?: string | null;
  payout?: number | null;
  remainingLegs?: number;
};

export function formatCancelledHtml(input: CancelledInput): string {
  const head = input.loadId
    ? `❌ <b>LEG CANCELLED</b> · Load <b>${esc(input.loadId)}</b> · Trip <b>${esc(input.tripId)}</b>`
    : `❌ <b>TRIP CANCELLED</b> · Trip <b>${esc(input.tripId)}</b>`;
  const lines = [head, ...routeLines(input.stops)];
  if (input.driver) lines.push(`👤 <b>${esc(input.driver)}</b>`);
  if (input.payout != null) lines.push(`💵 ${input.loadId ? "Leg pay" : "Trip pay"} ${esc(money(input.payout))}`);
  if (input.loadId && input.remainingLegs) {
    lines.push(`<i>${input.remainingLegs} other leg${input.remainingLegs === 1 ? "" : "s"} of this trip still active</i>`);
  }
  return lines.join("\n");
}

export type ReminderInput = {
  driver?: string | null;
  facility: string;
  city?: string | null;
  state?: string | null;
  tripId: string;
  loadId: string;
  stopSeq: number;
  stopCount: number;
  stopType?: string | null;
  plannedAt: string;
  minutesLeft: number;
  timeZone: string;
  eta?: string | null;
  tractor?: string | null;
  trailer?: string | null;
};

export function formatReminderHtml(input: ReminderInput): string {
  const kind = /drop|deliver/i.test(String(input.stopType || "")) ? "Drop-off" : "Pickup";
  const lines = [
    `⏳ ${driverHead(input.driver)} · ${kind} at <b>${esc(input.facility)}</b>${placeOf(input.city, input.state)} in <b>${esc(formatDurationMinutes(input.minutesLeft))}</b>`,
    `Trip <b>${esc(input.tripId)}</b> · Load ${esc(input.loadId)} · Stop ${input.stopSeq} of ${input.stopCount}`,
    `Scheduled <b>${esc(formatTimeAbbr(input.plannedAt, input.timeZone))}</b> · not checked in yet`,
  ];
  if (input.eta) {
    const late = new Date(input.eta).getTime() - new Date(input.plannedAt).getTime();
    lines.push(
      `ETA from Relay: ${esc(formatTimeAbbr(input.eta, input.timeZone))}` +
        (late > 15 * 60_000 ? ` · ⚠️ ${esc(formatDurationMinutes(late / 60_000))} after appointment` : ""),
    );
  }
  lines.push(`🚛 Tractor <b>${esc(input.tractor || "—")}</b> · Trailer <b>${esc(input.trailer?.trim() || "Bobtail")}</b>`);
  return lines.join("\n");
}

export type NotAtStopInput = {
  facility: string;
  city?: string | null;
  state?: string | null;
  tripId: string;
  loadId: string;
  stopSeq: number;
  stopCount: number;
  stopType?: string | null;
  plannedAt: string;
  overdueMinutes: number;
  timeZone: string;
  eta?: string | null;
  tractor?: string | null;
  trailer?: string | null;
  driver?: string | null;
  test?: boolean;
};

export function formatNotAtStopHtml(input: NotAtStopInput): string {
  const place = [input.city, input.state].filter(Boolean).join(", ");
  const stopType = input.stopType ? ` (${esc(input.stopType)})` : "";
  const trailer = input.trailer?.trim() || "Bobtail";
  const prefix = input.test ? "[TEST] " : "";
  const lines = [
    `${prefix}⏰ ${driverHead(input.driver)} · NOT at <b>${esc(input.facility)}</b>${place ? ` (${esc(place)})` : ""}`,
    `Trip <b>${esc(input.tripId)}</b> · Load ${esc(input.loadId)} · Stop ${input.stopSeq} of ${input.stopCount}${stopType}`,
    `Scheduled <b>${esc(formatTimeAbbr(input.plannedAt, input.timeZone))}</b> · now <b>${esc(formatDurationMinutes(input.overdueMinutes))}</b> overdue`,
  ];
  if (input.eta) {
    lines.push(`ETA from Relay: ${esc(formatTimeAbbr(input.eta, input.timeZone))}`);
  }
  lines.push(
    `🚛 Tractor <b>${esc(input.tractor || "—")}</b> · Trailer <b>${esc(trailer)}</b>`,
  );
  return lines.join("\n");
}
