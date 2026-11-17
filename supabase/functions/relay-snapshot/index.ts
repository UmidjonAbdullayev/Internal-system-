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
} from "./shared.ts";
import { upsertTrips } from "./upsert.ts";
import { beginCatchUp, finalizeCatchUp } from "./catchup.ts";

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

    const upserted = await upsertTrips(sb, tripsIn, now, {
      catchUp,
      forceHistory: catchUp,
    });
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
            const { error } = await sb
              .from("relay_trips")
              .update({
                status: "removed_from_relay",
                section: "HISTORY",
                needs_review: true,
                updated_at: now,
              })
              .eq("trip_id", row.trip_id);
            if (error) errors.push(`Snapshot remove ${row.trip_id}: ${error.message}`);
            else {
              snapshotRemoved += 1;
              await recordTripEvent(sb, {
                trip_id: row.trip_id,
                event_type: "removed_from_relay",
                from_section: section,
                to_section: "HISTORY",
                from_status: "moved_awaiting_section",
                to_status: "removed_from_relay",
              });
            }
          }
        }

        const { count: crmCount } = await sb
          .from("relay_trips")
          .select("trip_id", { count: "exact", head: true })
          .eq("section", section)
          .eq("archived", false)
          .neq("status", "removed_from_relay")
          .neq("status", "moved_awaiting_section");

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
        sectionCounts[section] = { relay: tripIds.length, crm, mismatch };

        await markSyncAttempt(sb, section, {
          last_successful_sync_at: syncedAt,
          last_attempt_at: now,
          syncing: false,
          last_error: null,
        });
      }
    }

    return json({
      success: true,
      trips_upserted: upserted.tripsUpserted,
      legs_upserted: upserted.legsUpserted,
      stops_upserted: upserted.stopsUpserted,
      snapshot_moved: snapshotMoved,
      snapshot_removed: snapshotRemoved,
      synced_trip_ids: upserted.syncedTripIds,
      live_missing: liveMissing,
      section_counts: sectionCounts,
      catch_up: catchUp,
      errors,
    });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});
