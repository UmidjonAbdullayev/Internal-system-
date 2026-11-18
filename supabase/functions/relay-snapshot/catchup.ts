import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { PAUSE_MS, recordTripEvent, sendRestoreSummary } from "./shared.ts";

export async function beginCatchUp(sb: SupabaseClient, liveMissing: string[]) {
  const now = new Date().toISOString();
  const { data: states } = await sb
    .from("sync_state")
    .select("section, last_successful_sync_at")
    .in("section", ["IN_TRANSIT", "UPCOMING"]);

  const stamps = (states || [])
    .map((r) => r.last_successful_sync_at)
    .filter(Boolean)
    .map((s) => Date.parse(String(s)));
  const gapStart =
    stamps.length > 0
      ? new Date(Math.min(...stamps)).toISOString()
      : new Date(Date.now() - PAUSE_MS).toISOString();

  await sb.from("relay_catch_up").upsert(
    {
      id: 1,
      active: true,
      gap_start: gapStart,
      gap_end: null,
      missing_trip_ids: liveMissing,
      found_trip_ids: [],
      removed_trip_ids: [],
      restore_summary_sent_at: null,
      updated_at: now,
    },
    { onConflict: "id" },
  );

  return {
    active: true,
    gap_start: gapStart,
    missing_trip_ids: liveMissing,
    catch_up_until: new Date(Date.parse(gapStart) - 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function finalizeCatchUp(sb: SupabaseClient) {
  const now = new Date().toISOString();
  const { data: cu } = await sb.from("relay_catch_up").select("*").eq("id", 1).maybeSingle();
  if (!cu?.active) {
    return { skipped: true, reason: "not_active" };
  }

  const missing: string[] = Array.isArray(cu.missing_trip_ids) ? cu.missing_trip_ids : [];
  const found: string[] = Array.isArray(cu.found_trip_ids) ? cu.found_trip_ids : [];
  const missingSet = new Set(missing.map((id) => String(id).toUpperCase()));
  const foundSet = new Set(found.map((id) => String(id).toUpperCase()));

  // Never touch trips Relay still lists on a live tab (IN_TRANSIT / UPCOMING snapshot).
  const { data: liveSnaps } = await sb
    .from("relay_section_snapshots")
    .select("section, trip_ids")
    .in("section", ["IN_TRANSIT", "UPCOMING"]);
  const stillOnRelay = new Set<string>();
  for (const snap of liveSnaps || []) {
    for (const id of (snap.trip_ids as string[]) || []) {
      const u = String(id || "").trim().toUpperCase();
      if (u) stillOnRelay.add(u);
    }
  }

  // History ONLY when catch-up actually found the trip in Relay's HISTORY response.
  // Merely missing from live tabs is NOT enough — leave those alone (live sync /
  // moved_awaiting owns them; snapshot restore will re-admit if Relay lists them).
  const foundInHistory = [...foundSet].filter(
    (id) => missingSet.has(id) && !stillOnRelay.has(id),
  );
  const stillMissing = missing.filter((id) => {
    const u = String(id).toUpperCase();
    return !foundSet.has(u) && !stillOnRelay.has(u);
  });
  const removed: string[] = [];

  for (const tripId of foundInHistory) {
    const { error } = await sb
      .from("relay_trips")
      .update({
        section: "HISTORY",
        needs_review: false,
        caught_up_at: now,
        updated_at: now,
      })
      .eq("trip_id", tripId);
    if (!error) {
      removed.push(tripId);
      await recordTripEvent(sb, {
        trip_id: tripId,
        event_type: "section_change",
        to_section: "HISTORY",
        detail: { reason: "catch_up_finalize", found_in_relay_history: true },
      });
    }
  }

  await sb.from("activity_logs").insert({
    type: "system",
    action: "catch_up",
    description:
      `(caught up after pause) found in HISTORY ${foundInHistory.length}, ` +
      `still missing (left alone) ${stillMissing.length}`,
    entity_id: null,
    user_name: "relay-snapshot",
  });

  const gapEnd = now;
  const tg = await sendRestoreSummary(sb, {
    found: found.length,
    removed: removed.length,
    gapStart: cu.gap_start || null,
    gapEnd,
  });

  // Suppress overdue for the resolved gap window (trip-alerts reads this)
  await sb.from("relay_catch_up").upsert(
    {
      id: 1,
      active: false,
      gap_start: cu.gap_start,
      gap_end: gapEnd,
      missing_trip_ids: missing,
      found_trip_ids: found,
      removed_trip_ids: removed,
      restore_summary_sent_at: tg.sent ? gapEnd : null,
      updated_at: gapEnd,
    },
    { onConflict: "id" },
  );

  // Hint for telegram trip-alerts: pause overdue until gap_end processed
  await sb
    .from("telegram_alert_config")
    .update({
      sync_stale_notified: false,
      updated_at: gapEnd,
    })
    .eq("id", 1)
    .then(() => null, () => null);

  return {
    found: found.length,
    found_in_history: foundInHistory.length,
    still_missing_left_alone: stillMissing.length,
    removed: removed.length,
    removed_trip_ids: removed,
    telegram: tg,
  };
}

