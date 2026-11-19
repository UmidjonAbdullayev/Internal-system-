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
    lines.push(`<i>Check-in showed up in Relay ${esc(formatDurationMinutes(input.reportedAfterMinutes))} later</i>`);
  }
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
