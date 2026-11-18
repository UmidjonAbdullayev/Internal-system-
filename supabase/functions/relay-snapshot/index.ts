import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  json,
  corsHeaders,
  requireExtensionKey,
  normalizeSection,
  isValidRelayId,
  markSyncAttempt,
  touchExtensionAlive,
  LIVE_SECTIONS,
  REMOVED_AFTER_MS,
  recordTripEvent,
  recordIncomeStatusChange,
  isFullyCancelledTrip,
} from "./shared.ts";
import { upsertTrips } from "./upsert.ts";
import { beginCatchUp, finalizeCatchUp } from "./catchup.ts";
import { remapStopsFromTripRaw } from "./remap-stops.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  const auth = requireExtensionKey(req);
  if (auth instanceof Response) return auth;

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json();
    const action = String(body.action || "upsert");
    const now = new Date().toISOString();

    if (action === "sync_status") {
      const { data: states } = await sb.from("sync_state").select("*");
      const { data: catchUp } = await sb.from("relay_catch_up").select("*").eq("id", 1).maybeSingle();
      const { data: snaps } = await sb.from("relay_section_snapshots").select("*");
      return json({ success: true, sync_state: states, catch_up: catchUp, snapshots: snaps });
    }

    if (action === "begin_catch_up") {
      const liveMissing = Array.isArray(body.missingTripIds)
        ? body.missingTripIds
          .map((id: unknown) => String(id || "").trim().toUpperCase())
          .filter((id: string) => isValidRelayId(id))
        : [];
      const result = await beginCatchUp(sb, liveMissing);
      return json({ success: true, catch_up: result });
    }

    if (action === "finalize_catch_up") {
      const result = await finalizeCatchUp(sb);
      return json({ success: true, ...result });
    }

    if (action === "heartbeat") {
      const authStatus = ["ok", "auth_required", "unknown"].includes(String(body.auth_status || ""))
        ? String(body.auth_status)
        : "ok";
      await touchExtensionAlive(sb, {
        now,
        authStatus,
        clientId: body.client_id != null ? String(body.client_id) : null,
        detail: body.detail != null ? String(body.detail) : null,
      });
      return json({ success: true, alive_at: now, auth_status: authStatus });
    }

    // Force remap stop times from stored trip.raw actions[] — no Telegram.
    if (action === "remap_stop_times") {
      const sections = Array.isArray(body.sections) ? body.sections : undefined;
      const result = await remapStopsFromTripRaw(sb, { sections });
      return json({
        success: true,
        telegram_alerts: "OFF",
        ...result,
      });
    }

    const tripsIn = Array.isArray(body.trips) ? body.trips : [];
    const snapshot = body.snapshot && typeof body.snapshot === "object" ? body.snapshot : null;
    const catchUp = Boolean(body.catchUp);

    // Successful authenticated sync traffic counts as liveness (MV3 setInterval heartbeats are unreliable).
    if (tripsIn.length > 0 || snapshot) {
      await touchExtensionAlive(sb, {
        now,
        authStatus: "ok",
        clientId: body.client_id != null ? String(body.client_id) : null,
        detail: snapshot?.section ? `sync:${snapshot.section}` : "sync",
      }).catch(() => null);
    }
    const errors: string[] = [];
    let snapshotMoved = 0;
    let snapshotRemoved = 0;
    let snapshotRestored = 0;
    const sectionCounts: Record<string, { relay: number; crm: number; mismatch: boolean }> = {};

    if (snapshot?.section) {
      const sec = normalizeSection(snapshot.section);
      if (sec) {
        await markSyncAttempt(sb, sec, {
          last_attempt_at: now,
          syncing: true,
          last_error: null,
        });
      }
    }

    const upsertStarted = Date.now();
    const upserted = await upsertTrips(sb, tripsIn, now, {
      catchUp,
      forceHistory: catchUp || Boolean(body.forceHistory),
    });
    const upsertMs = Date.now() - upsertStarted;
    console.log(
      JSON.stringify({
        msg: "relay-snapshot upsert",
        trips: tripsIn.length,
        section: snapshot?.section || null,
        catchUp,
        duration_ms: upsertMs,
        trips_upserted: upserted.tripsUpserted,
        legs_upserted: upserted.legsUpserted,
        stops_upserted: upserted.stopsUpserted,
      }),
    );
    errors.push(...upserted.errors);

    if (catchUp && upserted.syncedTripIds.length) {
      const { data: cu } = await sb.from("relay_catch_up").select("*").eq("id", 1).maybeSingle();
      if (cu?.active) {
        const prevFound: string[] = Array.isArray(cu.found_trip_ids) ? cu.found_trip_ids : [];
        const nextFound = [
          ...new Set([...prevFound, ...upserted.syncedTripIds].map((id) => id.toUpperCase())),
        ];
        const missing: string[] = Array.isArray(cu.missing_trip_ids) ? cu.missing_trip_ids : [];
        const stillMissing = missing.filter((id) => !nextFound.includes(String(id).toUpperCase()));
        await sb.from("relay_catch_up").update({
          found_trip_ids: nextFound,
          missing_trip_ids: stillMissing.length ? stillMissing : missing,
          updated_at: now,
        }).eq("id", 1);
      }
    }

    let liveMissing: string[] = [];

    if (snapshot?.section && Array.isArray(snapshot.tripIds)) {
      const section = normalizeSection(snapshot.section);
      if (!section) {
        errors.push(`Invalid snapshot section: ${snapshot.section}`);
      } else {
        const tripIds = [
          ...new Set(
            snapshot.tripIds
              .map((id: unknown) => String(id || "").trim().toUpperCase())
              .filter((id: string) => isValidRelayId(id)),
          ),
        ];
        const totalRecords = Number(snapshot.totalRecords) || 0;
        const syncedAt = snapshot.syncedAt || now;
        const inSnapshot = new Set(tripIds);

        // HISTORY: store trip IDs + section only — never reconcile (window ⊂ full CRM history).
        if (section === "HISTORY") {
          const { count: crmCount } = await sb
            .from("relay_trips")
            .select("trip_id", { count: "exact", head: true })
            .eq("section", "HISTORY")
            .eq("archived", false)
            .neq("status", "removed_from_relay");

          await sb.from("relay_section_snapshots").upsert(
            {
              section,
              trip_ids: tripIds,
              total_records: totalRecords,
              crm_count: crmCount ?? tripIds.length,
              mismatch: false,
              synced_at: syncedAt,
              updated_at: now,
            },
            { onConflict: "section" },
          );
          sectionCounts[section] = {
            relay: tripIds.length,
            crm: crmCount ?? tripIds.length,
            mismatch: false,
          };
          await markSyncAttempt(sb, section, {
            last_successful_sync_at: syncedAt,
            last_attempt_at: now,
            syncing: false,
            last_error: null,
          });
        } else {
          const { data: sectionRows, count: priorCount } = await sb
            .from("relay_trips")
            .select("trip_id, status, section", { count: "exact" })
            .eq("section", section)
            .eq("archived", false);

          // Never apply empty section sync if CRM previously had trips in this section.
          if (tripIds.length === 0 && (priorCount || 0) > 0) {
            const msg =
              `Skipped empty ${section} snapshot: CRM had ${priorCount} trip(s); refusing wipe`;
            console.warn(msg);
            errors.push(msg);
            await markSyncAttempt(sb, section, {
              last_attempt_at: now,
              syncing: false,
              last_error: msg,
            });
            sectionCounts[section] = {
              relay: 0,
              crm: priorCount || 0,
              mismatch: true,
            };
            return json({
              success: true,
              trips_upserted: upserted.tripsUpserted,
              legs_upserted: upserted.legsUpserted,
              stops_upserted: upserted.stopsUpserted,
              snapshot_moved: 0,
              snapshot_removed: 0,
              synced_trip_ids: upserted.syncedTripIds,
              section_counts: sectionCounts,
              empty_snapshot_skipped: true,
              errors,
            });
          }

          // Membership = Relay's latest tab response for NON-cancelled trips: re-admit
          // listed IDs even when change-only sync sends snapshot without bodies
          // (stranded HISTORY / removed_from_relay after catch-up finalize — #44).
          // RULE: fully cancelled (tourState cancelled OR every load CANCELLED) ALWAYS
          // stay/move to HISTORY — never re-admit onto UPCOMING/IN_TRANSIT.
          const cancelledInSnapshot = new Set<string>();
          if (LIVE_SECTIONS.has(section) && tripIds.length) {
            const { data: listedRows } = await sb
              .from("relay_trips")
              .select("trip_id, section, status, tour_state, execution_status")
              .in("trip_id", tripIds)
              .eq("archived", false);

            const listedIds = (listedRows || []).map((r: { trip_id: string }) => r.trip_id);
            const { data: listedLegs } = listedIds.length
              ? await sb
                  .from("relay_legs")
                  .select("trip_id, execution_status")
                  .in("trip_id", listedIds)
                  .eq("archived", false)
              : { data: [] as { trip_id: string; execution_status: string | null }[] };

            const legsByTrip = new Map<string, { executionStatus?: string }[]>();
            for (const leg of listedLegs || []) {
              const tid = String(leg.trip_id);
              const arr = legsByTrip.get(tid) || [];
              arr.push({ executionStatus: leg.execution_status ?? undefined });
              legsByTrip.set(tid, arr);
            }

            for (const row of listedRows || []) {
              const fullyCancelled = isFullyCancelledTrip(
                row.tour_state,
                legsByTrip.get(row.trip_id) || [],
              );
              if (fullyCancelled) {
                cancelledInSnapshot.add(row.trip_id);
                if (row.section !== "HISTORY" || !/cancel/i.test(String(row.status || ""))) {
                  const nextStatus =
                    row.status && /cancel/i.test(String(row.status))
                      ? row.status
                      : "CANCELLED";
                  const { error } = await sb
                    .from("relay_trips")
                    .update({
                      section: "HISTORY",
                      status: nextStatus,
                      updated_at: now,
                    })
                    .eq("trip_id", row.trip_id);
                  if (error) {
                    errors.push(`Snapshot cancel ${row.trip_id}: ${error.message}`);
                  } else if (row.section !== "HISTORY") {
                    await recordTripEvent(sb, {
                      trip_id: row.trip_id,
                      event_type: "cancelled_to_history",
                      from_section: row.section,
                      to_section: "HISTORY",
                      from_status: row.status,
                      to_status: nextStatus != null ? String(nextStatus) : "CANCELLED",
                      detail: { source: "snapshot_membership", source_tab: section },
                    });
                  }
                }
                continue;
              }

              const needsRestore =
                row.section !== section ||
                row.status === "removed_from_relay" ||
                row.status === "moved_awaiting_section";
              if (!needsRestore) continue;

              const restoredStatus =
                row.status === "removed_from_relay" ||
                row.status === "moved_awaiting_section"
                  ? String(row.execution_status || row.tour_state || section)
                  : row.status;
              const { error } = await sb
                .from("relay_trips")
                .update({
                  section,
                  source_tab: section,
                  status: restoredStatus,
                  needs_review: false,
                  last_seen_at: now,
                  updated_at: now,
                })
                .eq("trip_id", row.trip_id);
              if (error) {
                errors.push(`Snapshot restore ${row.trip_id}: ${error.message}`);
              } else {
                snapshotRestored += 1;
                await recordTripEvent(sb, {
                  trip_id: row.trip_id,
                  event_type: "section_change",
                  from_section: row.section,
                  to_section: section,
                  from_status: row.status,
                  to_status: restoredStatus != null ? String(restoredStatus) : null,
                  detail: { source: "snapshot_membership_restore", source_tab: section },
                });
              }
            }
          }

          for (const row of sectionRows || []) {
            if (inSnapshot.has(row.trip_id)) continue;
            if (LIVE_SECTIONS.has(section)) {
              liveMissing.push(row.trip_id);
              // Normal cycle: mark awaiting — History page1 next cycle reconciles
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
                await recordTripEvent(sb, {
                  trip_id: row.trip_id,
                  event_type: "moved_awaiting_section",
                  from_section: section,
                  to_section: section,
                  from_status: row.status,
                  to_status: "moved_awaiting_section",
                });
              }
            } else {
              const { error } = await sb
                .from("relay_trips")
                .update({ status: "moved_awaiting_section", updated_at: now })
                .eq("trip_id", row.trip_id);
              if (error) errors.push(`Snapshot move ${row.trip_id}: ${error.message}`);
              else snapshotMoved += 1;
            }
          }

          // Only auto-remove after 10m when NOT in an active catch-up (catch-up owns removals)
          const { data: cuActive } = await sb
            .from("relay_catch_up")
            .select("active")
            .eq("id", 1)
            .maybeSingle();
          if (!cuActive?.active) {
            const cutoff = new Date(Date.now() - REMOVED_AFTER_MS).toISOString();
            const { data: stale } = await sb
              .from("relay_trips")
              .select("trip_id")
              .eq("archived", false)
              .eq("status", "moved_awaiting_section")
              .lt("last_seen_at", cutoff);

            for (const row of stale || []) {
              if (inSnapshot.has(row.trip_id)) continue;
              // Do not wipe CANCELLED — TONU income needs cancel signal + payout > 0.
              const { data: staleFull } = await sb
                .from("relay_trips")
                .select("status, execution_status, tour_state, payout")
                .eq("trip_id", row.trip_id)
                .maybeSingle();
              const cancelBlob = `${staleFull?.status || ""} ${staleFull?.execution_status || ""} ${staleFull?.tour_state || ""}`.toLowerCase();
              const keepCancel =
                /cancel/.test(cancelBlob) ||
                (Number(staleFull?.payout) > 0 &&
                  /cancel/.test(String(staleFull?.execution_status || "").toLowerCase()));
              const nextStatus = keepCancel
                ? staleFull?.status && /cancel/i.test(String(staleFull.status))
                  ? staleFull.status
                  : "CANCELLED"
                : "removed_from_relay";
              const { error } = await sb
                .from("relay_trips")
                .update({
                  status: nextStatus,
                  section: "HISTORY",
                  needs_review: !keepCancel,
                  updated_at: now,
                })
                .eq("trip_id", row.trip_id);
              if (error) errors.push(`Snapshot remove ${row.trip_id}: ${error.message}`);
              else {
                snapshotRemoved += 1;
                await recordTripEvent(sb, {
                  trip_id: row.trip_id,
                  event_type: keepCancel ? "cancelled_to_history" : "removed_from_relay",
                  from_section: section,
                  to_section: "HISTORY",
                  from_status: "moved_awaiting_section",
                  to_status: nextStatus != null ? String(nextStatus) : null,
                  detail: {
                    source: "stale_soft_remove",
                    preserved_cancel: keepCancel,
                    code_path: "relay-snapshot/index.ts:stale_soft_remove",
                    reason: keepCancel
                      ? "preserve_cancel_for_tonu"
                      : "stale_moved_awaiting",
                  },
                });
                await recordIncomeStatusChange(sb, {
                  trip_id: row.trip_id,
                  from_status: "moved_awaiting_section",
                  to_status: nextStatus != null ? String(nextStatus) : null,
                  from_execution: staleFull?.execution_status != null
                    ? String(staleFull.execution_status)
                    : null,
                  to_execution: staleFull?.execution_status != null
                    ? String(staleFull.execution_status)
                    : null,
                  payout: Number(staleFull?.payout) || 0,
                  reason: keepCancel
                    ? "soft_remove_preserve_cancel"
                    : "soft_remove_to_removed_from_relay",
                  code_path: "relay-snapshot/index.ts:stale_soft_remove",
                  from_section: section,
                  to_section: "HISTORY",
                });
              }
            }
          }

          // Live tabs: CRM + Relay counts are ACTIVE-only (exclude fully cancelled).
          // Relay may still return cancelled IDs on Upcoming; those stay in HISTORY.
          const { data: crmRows } = await sb
            .from("relay_trips")
            .select("trip_id, status, tour_state")
            .eq("section", section)
            .eq("archived", false)
            .neq("status", "removed_from_relay")
            .neq("status", "moved_awaiting_section");

          const crmActive = (crmRows || []).filter((r: {
            status?: string | null;
            tour_state?: string | null;
          }) => {
            const blob = `${r.tour_state || ""} ${r.status || ""}`.toLowerCase();
            return !/cancel/.test(blob);
          }).length;

          const relayActive = LIVE_SECTIONS.has(section)
            ? tripIds.filter((id) => !cancelledInSnapshot.has(id)).length
            : tripIds.length;
          const crm = crmActive;
          const mismatch = crm !== relayActive;
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
          sectionCounts[section] = { relay: relayActive, crm, mismatch };

          await markSyncAttempt(sb, section, {
            last_successful_sync_at: syncedAt,
            last_attempt_at: now,
            syncing: false,
            last_error: null,
          });
        }
      }
    }

    return json({
      success: true,
      trips_upserted: upserted.tripsUpserted,
      legs_upserted: upserted.legsUpserted,
      stops_upserted: upserted.stopsUpserted,
      snapshot_moved: snapshotMoved,
      snapshot_removed: snapshotRemoved,
      snapshot_restored: snapshotRestored,
      synced_trip_ids: upserted.syncedTripIds,
      live_missing: liveMissing,
      section_counts: sectionCounts,
      catch_up: catchUp,
      duration_ms: upsertMs,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ msg: "relay-snapshot fatal", error: message }));
    return json({ success: false, error: message }, 500);
  }
});
